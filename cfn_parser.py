import re
import yaml
from models import (
    ECSService, DynamoDBTable, SQSQueue,
    LambdaFunction, InfrastructureGraph, EventBus, EventBridgeRule,
)


class CloudFormationParser:
    """Parser per template CloudFormation.

    Uso tipico (multi-template sequenziale):

        parser = CloudFormationParser()
        parser.load_params(default_params_dict)            # base layer
        parser.process_template(storage_yaml_text)         # outputs → params
        parser.process_template(microservice_yaml_text)    # usa params precedenti
        parser.reconcile_connections()                     # unica passata finale
        graph = parser.graph
    """

    def __init__(self, graph: InfrastructureGraph = None):
        self.graph = graph or InfrastructureGraph()
        self.cfn_parameters: dict = {}    # Descrizioni dei parametri del template
        self.parameter_values: dict = {}  # Valori concreti (default + outputs + override)
        self.policy_to_owner: dict = {}

    @property
    def _region(self) -> str:
        return self.parameter_values.get('AWS::Region', 'eu-south-1')

    @property
    def _account(self) -> str:
        return self.parameter_values.get('AWS::AccountId', '123456789012')

    # =========================================================================
    # PUBLIC API
    # =========================================================================

    def load_params(self, defaults: dict):
        """Carica valori di default (es. da default_params.json).
        Non sovrascrive valori già presenti (setdefault)."""
        for k, v in defaults.items():
            if not k.startswith('_'):
                self.parameter_values.setdefault(k, str(v))

    def process_template(self, yaml_text: str, extra_params: dict = None):
        """Pipeline completa su un singolo template YAML:
        1. Parse YAML
        2. Applica extra_params (precedenza massima)
        3. Carica Default dei Parameters del template
        4. Estrae tutte le risorse nel graph
        5. Risolve gli Outputs → nuovi parameter_values per il template successivo

        Ritorna il dict del template o None in caso di errore.
        """
        template = self.parse_yaml(yaml_text)
        if not template:
            return None

        if extra_params:
            self.parameter_values.update({k: str(v) for k, v in extra_params.items()})

        self._load_template_param_defaults(template)
        self._extract_all_resources(template)
        self._derive_outputs_as_params(template)

        return template

    def reconcile_connections(self):
        """Costruisce le connessioni bidirezionali dopo aver processato tutti i template.

        Relazioni prodotte:
          SQS --triggers--> Lambda           (EventSourceMapping)
          EventBridgeRule --triggers--> Lambda/SQS  (target della regola)
          ECS/Lambda --triggers--> EventBridgeRule  (match detail-type sull'EventBus)

        Chiamare una sola volta, dopo tutti i process_template().
        """
        print("\n\U0001f517 Riconciliazione connessioni...")

        # 1. SQS → Lambda (EventSourceMapping)
        for func in self.graph.lambda_functions.values():
            for source_ref in func.event_sources:
                queue = self._find_resource_by_ref(source_ref)
                if queue and isinstance(queue, SQSQueue):
                    func.add_connection('triggered_by', queue.arn)
                    queue.add_connection('triggers', func.arn)
                    print(f"    ✓ SQS→Lambda: {queue.name} → {func.name}")

        # 2. EventBridge rule → target
        for rule in self.graph.eventbus_rules.values():
            for target_arn in rule.target_arns:
                target = self.graph.resolve(target_arn) or self._find_resource_by_ref(target_arn)
                if target:
                    target.add_connection('triggered_by', rule.arn)
                    print(f"    ✓ Rule→Target: {rule.name} → {target.name}")

        # 3. EventBus publisher → matching EventBridge rules (via Condition detail-type)
        all_resources = [
            *self.graph.ecs_services.values(),
            *self.graph.lambda_functions.values(),
            *self.graph.sqs_queues.values(),
            *self.graph.external_services.values(),
        ]
        publishers = [(r, bus, dt)
                      for r in all_resources
                      for bus, dt in r.publishes_events.items()]
        print(f"    [EB] {len(publishers)} publisher(s) con publishes_events; "
              f"{len(self.graph.eventbus_rules)} regola/e EB nel grafo")
        for resource, bus_arn, detail_types in publishers:
            print(f"      → {resource.name}: bus={bus_arn.split('/')[-1]} "
                  f"detail-types={detail_types or 'qualsiasi'}")
            self._link_owner_to_matching_rules(resource, bus_arn, detail_types)

    # =========================================================================
    # YAML PARSING
    # =========================================================================

    @staticmethod
    def parse_yaml(content: str):
        """Parse YAML con supporto alle funzioni intrinseche CloudFormation
        (!Sub, !Ref, !GetAtt, …) convertite in dict {'Fn': ..., 'Value': ...}."""
        try:
            def cfn_constructor(loader, tag_suffix, node):
                if isinstance(node, yaml.ScalarNode):
                    return {'Fn': tag_suffix, 'Value': loader.construct_scalar(node)}
                elif isinstance(node, yaml.SequenceNode):
                    return {'Fn': tag_suffix, 'Value': loader.construct_sequence(node)}
                elif isinstance(node, yaml.MappingNode):
                    return {'Fn': tag_suffix, 'Value': loader.construct_mapping(node)}
                return None

            yaml.add_multi_constructor('!', cfn_constructor, Loader=yaml.SafeLoader)
            return yaml.safe_load(content)
        except Exception as e:
            print(f"  ✗ Errore parsing YAML: {e}")
            return None

    # =========================================================================
    # VALUE RESOLUTION
    # =========================================================================

    def resolve_value(self, value):
        """Risolve Ref / Sub usando i parameter_values correnti."""
        if not isinstance(value, dict):
            return value
        fn  = value.get('Fn')
        val = value.get('Value')
        if fn == 'Ref':
            return self.parameter_values.get(val, val)
        if fn == 'Sub' and isinstance(val, str):
            result = val
            for param, pval in self.parameter_values.items():
                result = result.replace(f'${{{param}}}', str(pval))
            return result
        return value

    def extract_ref_name(self, value) -> str:
        """Estrae il nome logico da Ref o GetAtt."""
        if isinstance(value, dict) and 'Fn' in value:
            fn_type  = value['Fn']
            fn_value = value['Value']
            if fn_type == 'Ref':
                return fn_value
            if fn_type == 'GetAtt':
                return fn_value[0] if isinstance(fn_value, list) else str(fn_value).split('.')[0]
        return str(value)

    # =========================================================================
    # PARAMETER LOADING
    # =========================================================================

    async def load_params_github(self, owner: str, repo: str, branch: str = 'develop'):
        """Carica i parametri dal file CFN JSON di configurazione del repo.

        Supporta due formati:
        - Array CFN standard: [{"ParameterKey": "k", "ParameterValue": "v"}, ...]
        - Oggetto con chiave Parameters: {"Parameters": {"k": "v", ...}}
        """
        import urllib.request, json, urllib.error
        param_files = ['scripts/aws/cfn/microservice-dev-cfg.json']
        for param_file in param_files:
            url = f'https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{param_file}'
            try:
                with urllib.request.urlopen(url, timeout=10) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    # Formato oggetto: {"Parameters": {"key": "value"}}
                    if isinstance(data, dict):
                        params = data.get('Parameters', data)
                        for key, value in params.items():
                            if key and value is not None:
                                self.parameter_values[key] = str(value)
                    # Formato array CFN: [{"ParameterKey": "k", "ParameterValue": "v"}]
                    elif isinstance(data, list):
                        for p in data:
                            key   = p.get('ParameterKey')
                            value = p.get('ParameterValue')
                            if key and value is not None:
                                self.parameter_values[key] = str(value)
                    print(f"    ✓ Parametri caricati: {param_file} ({len(self.parameter_values)} totali)")
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    print(f"    ✗ Errore HTTP {e.code}: {param_file}")
            except Exception as e:
                print(f"    ✗ Errore: {param_file} - {e}")

    def _load_template_param_defaults(self, template: dict):
        """Carica i Default dei Parameters del template (non sovrascrive valori già noti)."""
        for param_name, param_def in template.get('Parameters', {}).items():
            self.cfn_parameters[param_name] = param_def.get('Description', '')
            if 'Default' in param_def and param_name not in self.parameter_values:
                self.parameter_values[param_name] = str(param_def['Default'])

    # =========================================================================
    # OUTPUT RESOLUTION → parametri per il template successivo
    # =========================================================================

    def _derive_outputs_as_params(self, template: dict):
        """Risolve gli Outputs del template e li inietta in parameter_values
        in modo che il template successivo possa usarli come parametri di input."""
        resources = template.get('Resources', {})
        for out_name, out_def in template.get('Outputs', {}).items():
            resolved = self._resolve_output_value(out_def.get('Value'), resources)
            if resolved is not None:
                self.parameter_values[out_name] = str(resolved)
                print(f"    → Output: {out_name} = {resolved}")

    def _resolve_output_value(self, value, resources: dict):
        """Risolve un singolo valore di output (Ref / Sub / GetAtt)."""
        if value is None:
            return None
        if isinstance(value, str):
            return self.resolve_value(value)
        if not isinstance(value, dict):
            return None

        fn  = value.get('Fn')
        val = value.get('Value')

        if fn == 'Ref':
            return (self.parameter_values.get(val)
                    or self._resource_name(val, resources)
                    or val)

        if fn == 'Sub' and isinstance(val, str):
            result = val
            for param, pval in self.parameter_values.items():
                result = result.replace(f'${{{param}}}', str(pval))
            # Risolvi ${LogicalId.Attr} (es. ${PaperTrackingsErrorsTable.Arn})
            def replace_getatt(m):
                lid, attr = m.group(1), m.group(2)
                resolved = self._get_resource_attr(lid, attr, resources)
                return str(resolved) if resolved is not None else m.group(0)
            result = re.sub(r'\$\{([^.}\s]+)\.([^}\s]+)\}', replace_getatt, result)
            return result

        if fn == 'GetAtt':
            if isinstance(val, list) and len(val) == 2:
                logical_id, attr_path = val[0], val[1]
            elif isinstance(val, str):
                parts = val.split('.', 1)
                logical_id = parts[0]
                attr_path  = parts[1] if len(parts) > 1 else ''
            else:
                return None
            return self._get_resource_attr(logical_id, attr_path, resources)

        return None

    def _resource_name(self, logical_id: str, resources: dict):
        """Ritorna il nome concreto di una risorsa (TableName, FunctionName, …)."""
        resource = resources.get(logical_id)
        if not resource:
            return None
        res_type = resource.get('Type', '')
        props    = resource.get('Properties', {})
        if res_type == 'AWS::DynamoDB::Table':
            return self.resolve_value(props.get('TableName', logical_id))
        if res_type == 'AWS::Lambda::Function':
            return self.resolve_value(props.get('FunctionName', logical_id))
        if res_type == 'AWS::SQS::Queue':
            return self.resolve_value(props.get('QueueName', logical_id))
        return logical_id

    def _get_resource_attr(self, logical_id: str, attr_path: str, resources: dict):
        """Risolve GetAtt / ${LogicalId.Attr} per i tipi di risorsa supportati.

        Supporta:
        - Nested Stack sqs-queue  → Outputs.QueueName / QueueARN / QueueURL
        - Nested Stack log-group  → Outputs.LogGroupName
        - AWS::DynamoDB::Table    → Arn
        - AWS::Lambda::Function   → Arn
        """
        region  = self.parameter_values.get('AWS::Region',    'eu-south-1')
        account = self.parameter_values.get('AWS::AccountId', '123456789012')

        resource = resources.get(logical_id)
        if not resource:
            return None

        res_type = resource.get('Type', '')
        props    = resource.get('Properties', {})

        # ── Nested CloudFormation Stack ────────────────────────────────────
        if res_type == 'AWS::CloudFormation::Stack':
            params       = props.get('Parameters', {})
            template_url = str(self.resolve_value(props.get('TemplateURL', ''))).lower()

            if 'sqs-queue' in template_url:
                queue_name = self.resolve_value(params.get('QueueName', ''))
                arn  = f'arn:aws:sqs:{region}:{account}:{queue_name}'
                url  = f'https://sqs.{region}.amazonaws.com/{account}/{queue_name}'
                # Arricchisci il nodo già nel graph
                for q in self.graph.sqs_queues.values():
                    if q.logical_id == logical_id:
                        q.arn = arn
                        self.graph.register_arn(arn, q)
                return {
                    'Outputs.QueueName': queue_name,
                    'Outputs.QueueARN':  arn,
                    'Outputs.QueueURL':  url,
                }.get(attr_path)

            if 'log-group' in template_url:
                log_name = self.resolve_value(params.get('LogGroupName', ''))
                return log_name if 'Outputs.LogGroupName' in attr_path else None

            return None

        # ── DynamoDB Table ─────────────────────────────────────────────────
        if res_type == 'AWS::DynamoDB::Table':
            table_name = self.resolve_value(props.get('TableName', logical_id))
            arn = f'arn:aws:dynamodb:{region}:{account}:table/{table_name}'
            for t in self.graph.dynamodb_tables.values():
                if t.logical_id == logical_id:
                    t.arn = arn
                    self.graph.register_arn(arn, t)
            return arn if attr_path == 'Arn' else None

        # ── Lambda Function ────────────────────────────────────────────────
        if res_type == 'AWS::Lambda::Function':
            func_name = self.resolve_value(props.get('FunctionName', logical_id))
            arn = f'arn:aws:lambda:{region}:{account}:function:{func_name}'
            for f in self.graph.lambda_functions.values():
                if f.logical_id == logical_id:
                    f.arn = arn
                    self.graph.register_arn(arn, f)
            return arn if attr_path == 'Arn' else None

        return None

    # =========================================================================
    # RESOURCE EXTRACTION
    # =========================================================================

    def _extract_all_resources(self, template: dict):
        self.extract_ecs_services(template)
        self.extract_dynamodb_tables(template)
        self.extract_sqs_queues(template)
        self.extract_lambda_functions(template)
        # EventBus e regole devono essere estratti PRIMA delle policy IAM
        # in modo che _link_owner_to_matching_rules le trovi già in graph
        self.extract_eventbuses(template)
        self.extract_eventbridge_rules(template)
        self.extract_iam_policies(template)

    def extract_ecs_services(self, cfn_template: dict):
        """Estrae i servizi ECS da nested stack ecs-service."""
        for logical_id, resource in cfn_template.get('Resources', {}).items():
            if resource.get('Type') != 'AWS::CloudFormation::Stack':
                continue
            props        = resource.get('Properties', {})
            template_url = self.resolve_value(props.get('TemplateURL', ''))
            if 'ecs-service' not in str(template_url).lower():
                continue

            params       = props.get('Parameters', {})
            service_name = self.resolve_value(params.get('MicroServiceUniqueName', logical_id))
            svc = ECSService(logical_id, service_name)
            svc.cpu               = self.resolve_value(params.get('CpuValue'))
            svc.memory            = self.resolve_value(params.get('MemoryAmount'))
            svc.container_image   = self.resolve_value(params.get('ContainerImageURI', ''))
            svc.health_check_path = params.get('HealthCheckPath')

            for key, value in params.items():
                if key.startswith('ContainerEnvEntry'):
                    env_value = self.resolve_value(value)
                    if '=' in str(env_value):
                        env_name, env_val = str(env_value).split('=', 1)
                        svc.environment_vars[env_name] = env_val

            task_role = params.get('TaskRoleManagedPolicyArn')
            if task_role:
                policy_ref = self.extract_ref_name(task_role)
                svc.task_role_policy = policy_ref
                self.policy_to_owner[policy_ref] = svc

            svc.arn = f'arn:aws:ecs:{self._region}:{self._account}:service/{service_name}'
            self.graph.add_ecs_service(svc)
            print(f"    ✓ ECS Service: {service_name}")

    def extract_dynamodb_tables(self, cfn_template: dict):
        """Estrae le tabelle DynamoDB."""
        outputs = cfn_template.get('Outputs', {})
        for logical_id, resource in cfn_template.get('Resources', {}).items():
            if resource.get('Type') != 'AWS::DynamoDB::Table':
                continue
            props      = resource.get('Properties', {})
            table_name = self.resolve_value(props.get('TableName', logical_id))
            table      = DynamoDBTable(logical_id, table_name)

            for key in props.get('KeySchema', []):
                if key['KeyType'] == 'HASH':
                    table.hash_key = key['AttributeName']
                elif key['KeyType'] == 'RANGE':
                    table.range_key = key['AttributeName']

            for gsi in props.get('GlobalSecondaryIndexes', []):
                table.gsi.append(gsi.get('IndexName'))

            stream_spec = props.get('StreamSpecification', {})
            if stream_spec:
                table.stream = stream_spec.get('StreamViewType')

            ttl_spec = props.get('TimeToLiveSpecification', {})
            if ttl_spec.get('Enabled'):
                table.ttl = ttl_spec.get('AttributeName')

            for out_name, out_value in outputs.items():
                out_val = str(out_value.get('Value', ''))
                if logical_id in out_val and 'Arn' in out_name:
                    table.arn_param = out_name
                    break

            table.arn = f'arn:aws:dynamodb:{self._region}:{self._account}:table/{table_name}'
            self.graph.add_dynamodb_table(table)
            print(f"    ✓ DynamoDB: {table_name}")

    def extract_sqs_queues(self, cfn_template: dict):
        """Estrae le code SQS (nested stack o risorsa diretta)."""
        outputs = cfn_template.get('Outputs', {})
        for logical_id, resource in cfn_template.get('Resources', {}).items():
            res_type = resource.get('Type', '')
            props    = resource.get('Properties', {})

            if res_type == 'AWS::CloudFormation::Stack':
                params         = props.get('Parameters', {})
                queue_name_raw = params.get('QueueName')
                if not queue_name_raw:
                    continue
                resolved_name = self.resolve_value(queue_name_raw)
                queue = SQSQueue(logical_id, resolved_name)
                queue.visibility_timeout = params.get('VisibilityTimeout')
                queue.has_dlq   = params.get('HasDLQ',       'true') != 'false'
                queue.has_alarm = params.get('QueueHasAlarm', 'true') != 'false'

                for out_name, out_value in outputs.items():
                    out_val = str(out_value.get('Value', ''))
                    if logical_id in out_val and 'ARN' in out_name:
                        queue.arn_param = out_name
                        break

                queue.arn = f'arn:aws:sqs:{self._region}:{self._account}:{resolved_name}'
                self.graph.add_sqs_queue(queue)
                print(f"    ✓ SQS Queue: {resolved_name}")

            elif res_type == 'AWS::SQS::Queue':
                queue_name = self.resolve_value(props.get('QueueName', logical_id))
                queue = SQSQueue(logical_id, queue_name)
                queue.visibility_timeout = props.get('VisibilityTimeoutSeconds')
                queue.has_dlq = 'RedrivePolicy' in props
                queue.arn = f'arn:aws:sqs:{self._region}:{self._account}:{queue_name}'
                self.graph.add_sqs_queue(queue)
                print(f"    ✓ SQS Queue: {queue_name}")

    def extract_lambda_functions(self, cfn_template: dict):
        """Estrae Lambda functions e i loro EventSourceMapping."""
        resources = cfn_template.get('Resources', {})

        for logical_id, resource in resources.items():
            if resource.get('Type') != 'AWS::Lambda::Function':
                continue
            props     = resource.get('Properties', {})
            func_name = self.resolve_value(props.get('FunctionName', logical_id))
            func = LambdaFunction(logical_id, func_name)
            func.runtime  = props.get('Runtime')
            func.memory   = props.get('MemorySize')
            func.timeout  = props.get('Timeout')
            func.handler  = props.get('Handler')

            role = props.get('Role', {})
            if isinstance(role, dict) and role.get('Fn') == 'GetAtt':
                role_parts = role.get('Value', [])
                func.role_logical_id = (role_parts[0] if isinstance(role_parts, list)
                                        else role_parts)

            func.arn = f'arn:aws:lambda:{self._region}:{self._account}:function:{func_name}'
            self.graph.add_lambda_function(func)
            print(f"    ✓ Lambda: {func_name}")

        for logical_id, resource in resources.items():
            if resource.get('Type') != 'AWS::Lambda::EventSourceMapping':
                continue
            props      = resource.get('Properties', {})
            func_name  = self.extract_ref_name(props.get('FunctionName'))
            source_ref = self.extract_ref_name(props.get('EventSourceArn'))

            for func in self.graph.lambda_functions.values():
                if func_name in func.name or func.logical_id == func_name:
                    func.event_sources.append(source_ref)
                    print(f"    ✓ Trigger: {source_ref} -> {func.name}")

    def extract_iam_policies(self, cfn_template: dict):
        """Estrae policy IAM e determina le relazioni tra risorse."""
        resources = cfn_template.get('Resources', {})
        for logical_id, resource in resources.items():
            res_type = resource.get('Type', '')
            props    = resource.get('Properties', {})

            if res_type == 'AWS::IAM::ManagedPolicy':
                owner_check = self.policy_to_owner.get(logical_id)
                if not owner_check:
                    print(f"    ⚠️ ManagedPolicy '{logical_id}' — nessun owner (known: {list(self.policy_to_owner.keys())})")
                self._extract_permissions_from_policy(logical_id, props.get('PolicyDocument', {}))

            elif res_type == 'AWS::IAM::Role':
                for policy in props.get('Policies', []):
                    for func in self.graph.lambda_functions.values():
                        if func.role_logical_id == logical_id:
                            self.policy_to_owner[logical_id] = func
                    self._extract_permissions_from_policy(logical_id, policy.get('PolicyDocument', {}))

            elif res_type == 'AWS::IAM::Policy':
                for role_ref in props.get('Roles', []):
                    role_name = self.extract_ref_name(role_ref)
                    for func in self.graph.lambda_functions.values():
                        if func.role_logical_id == role_name:
                            self.policy_to_owner[logical_id] = func
                self._extract_permissions_from_policy(logical_id, props.get('PolicyDocument', {}))

    def extract_eventbuses(self, cfn_template: dict):
        """Estrae gli Event Bus EventBridge (AWS::Events::EventBus)."""
        for logical_id, resource in cfn_template.get('Resources', {}).items():
            if resource.get('Type') != 'AWS::Events::EventBus':
                continue
            props    = resource.get('Properties', {})
            bus_name = self.resolve_value(props.get('Name', logical_id))
            bus      = EventBus(logical_id, bus_name)
            bus.arn  = f'arn:aws:events:{self._region}:{self._account}:event-bus/{bus_name}'
            self.graph.add_eventbus(bus)
            print(f"    ✓ EventBus: {bus_name}")

    def extract_eventbridge_rules(self, cfn_template: dict):
        """Estrae le regole EventBridge e le collega alle risorse target."""
        for logical_id, resource in cfn_template.get('Resources', {}).items():
            if resource.get('Type') != 'AWS::Events::Rule':
                continue
            props = resource.get('Properties', {})

            rule_name = self.resolve_value(props.get('Name', logical_id))
            rule = EventBridgeRule(logical_id, rule_name)
            rule.event_bus_name = self.resolve_value(props.get('EventBusName', ''))

            pattern = props.get('EventPattern', {})
            # EventPattern può essere una stringa JSON o un dict
            if isinstance(pattern, str):
                try:
                    import json as _json
                    pattern = _json.loads(pattern)
                except Exception:
                    pattern = {}
            rule.event_pattern = pattern
            rule.arn = f'arn:aws:events:{self._region}:{self._account}:rule/{rule_name}'

            for target in props.get('Targets', []):
                target_id  = self.resolve_value(target.get('Id', ''))
                target_arn = self.resolve_value(target.get('Arn', ''))
                if isinstance(target_arn, dict):
                    target_arn = str(self.extract_ref_name(target_arn))
                target_arn = str(target_arn)
                rule.target_ids.append(str(target_id))
                rule.target_arns.append(target_arn)
                rule.add_connection('triggers', target_arn)

                # Se il target è già nel graph, aggiunge triggered_by sull'altro lato
                found = self.graph.resolve(target_arn) or self._find_resource_by_ref(
                    self.extract_ref_name(target.get('Arn', ''))
                )
                if found:
                    found.add_connection('triggered_by', rule.arn)
                    print(f"    ✓ EventBridge: {rule_name} -> {found.name}")

            self.graph.add_eventbus_rule(rule)
            detail_types = pattern.get('detail-type', [])
            print(f"    ✓ EventBridge Rule: {rule_name} ({', '.join(detail_types) or 'n/a'})")

    # =========================================================================
    # PERMISSIONS & CONNECTIONS
    # =========================================================================

    def _extract_permissions_from_policy(self, policy_id: str, policy_doc: dict):
        owner = self.policy_to_owner.get(policy_id)
        if not owner:
            return

        for statement in policy_doc.get('Statement', []):
            if statement.get('Effect') != 'Allow':
                continue

            actions = statement.get('Action', [])
            if isinstance(actions, str):
                actions = [actions]

            resources_list = statement.get('Resource', [])
            if isinstance(resources_list, str):
                resources_list = [resources_list]

            ddb_read  = any(any(op in a for op in ('Get', 'Query', 'Scan', 'BatchGet'))
                            for a in actions if 'dynamodb' in a.lower())
            ddb_write = any(any(op in a for op in ('Put', 'Update', 'Delete', 'BatchWrite'))
                            for a in actions if 'dynamodb' in a.lower())
            sqs_recv  = any(any(op in a for op in ('Receive', 'DeleteMessage'))
                            for a in actions if 'sqs' in a.lower())
            sqs_send  = any('Send' in a for a in actions if 'sqs' in a.lower())
            eb_write  = any('PutEvents' in a for a in actions if 'events' in a.lower())

            # Estrae detail-type dalla Condition (events:detail-type o detail-type)
            eb_detail_types: list = []
            if eb_write:
                print(f"    [IAM-EB] {owner.name}: PutEvents trovato, Condition={statement.get('Condition', {})}")
                condition = statement.get('Condition', {})
                for _op, cond_map in condition.items():
                    if isinstance(cond_map, dict):
                        for cond_key, cond_val in cond_map.items():
                            if 'detail-type' in cond_key.lower():
                                if isinstance(cond_val, list):
                                    eb_detail_types.extend(cond_val)
                                elif isinstance(cond_val, str):
                                    eb_detail_types.append(cond_val)

            for res in resources_list:
                # Prima prova a risolvere l'ARN direttamente (utile per !Sub arn:...)
                resolved_arn = str(self.resolve_value(res))
                target = (self.graph.resolve(resolved_arn)
                          or self._find_resource_by_ref(self.extract_ref_name(res)))

                # EventBus PutEvents: anche se il bus non è in questo template,
                # l'ARN risolto è sufficiente per registrare la connessione.
                if not target and eb_write and ':event-bus/' in resolved_arn:
                    owner.add_connection('writes_to', resolved_arn)
                    # Salva per reconcile_connections() — anche senza Condition (empty = match all)
                    owner.publishes_events.setdefault(resolved_arn, set()).update(eb_detail_types)
                    print(f"      → {owner.name} scrive su EventBus (esterno): "
                          f"{resolved_arn.split('/')[-1]} detail-types={eb_detail_types or 'any'}")
                    continue

                if not target:
                    continue

                if isinstance(target, DynamoDBTable):
                    if ddb_read:
                        owner.add_connection('reads_from', target.arn)
                    if ddb_write:
                        owner.add_connection('reads_from', target.arn)
                        owner.add_connection('writes_to', target.arn)
                    print(f"      → {owner.name} accede a DynamoDB: {target.name}")

                elif isinstance(target, SQSQueue):
                    if sqs_recv:
                        owner.add_connection('reads_from', target.arn)
                        print(f"      → {owner.name} legge da SQS: {target.name}")
                    if sqs_send:
                        owner.add_connection('writes_to', target.arn)
                        print(f"      → {owner.name} invia a SQS: {target.name}")

                elif isinstance(target, EventBus):
                    if eb_write:
                        owner.add_connection('writes_to', target.arn)
                        # Salva per reconcile_connections() — anche senza Condition (empty = match all)
                        owner.publishes_events.setdefault(target.arn, set()).update(eb_detail_types)
                        print(f"      → {owner.name} scrive su EventBus (in grafo): "
                              f"{target.name} detail-types={eb_detail_types or 'any'}")

    def _link_owner_to_matching_rules(self, owner, bus_arn: str, detail_types):
        """Collega owner alle EventBridgeRule il cui event_pattern detail-type combacia.
        Se detail_types è vuoto (nessuna Condition), collega a TUTTE le regole sul bus."""
        bus_name = bus_arn.split('/')[-1] if '/' in bus_arn else bus_arn
        for rule in self.graph.eventbus_rules.values():
            # Filtra per bus: salta regole su un bus diverso
            rule_bus = rule.event_bus_name
            if rule_bus and rule_bus not in (bus_arn, bus_name):
                print(f"        skip '{rule.name}' bus='{rule_bus}' != '{bus_name}'")
                continue
            pattern_dt = rule.event_pattern.get('detail-type', [])
            if isinstance(pattern_dt, str):
                pattern_dt = [pattern_dt]
            # Nessun filtro detail-type → match su tutte le regole del bus
            if not detail_types or any(dt in detail_types for dt in pattern_dt):
                owner.add_connection('triggers', rule.arn)
                rule.add_connection('triggered_by', owner.arn)
                print(f"        ✓ {owner.name} → '{rule.name}' (pattern={pattern_dt})")
            else:
                print(f"        skip '{rule.name}' pattern={pattern_dt} non in {detail_types}")

    def _find_resource_by_ref(self, ref):
        """Trova una risorsa nel graph dato un riferimento (nome, logical_id, arn_param)."""
        if not ref:
            return None
        ref_str = str(ref)

        for table in self.graph.dynamodb_tables.values():
            if table.arn_param and table.arn_param in ref_str:
                return table
            if table.name in ref_str or table.logical_id in ref_str:
                return table
            if 'Table' in ref_str:
                guess = ref_str.replace('Arn', '').replace('Name', '')
                if guess in table.logical_id or table.logical_id in guess:
                    return table

        for queue in self.graph.sqs_queues.values():
            if queue.arn_param and queue.arn_param in ref_str:
                return queue
            if queue.name in ref_str or queue.logical_id in ref_str:
                return queue
            if 'Queue' in ref_str:
                guess = ref_str.replace('ARN', '').replace('URL', '').replace('Name', '')
                if guess in queue.logical_id or queue.logical_id in guess:
                    return queue

        for bus in self.graph.eventbuses.values():
            if bus.arn and bus.arn == ref_str:
                return bus
            if bus.name in ref_str or bus.logical_id in ref_str:
                return bus

        return None
