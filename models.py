# =============================================================================
# DOMAIN MODELS - Rappresentazione delle risorse AWS
# =============================================================================

class AWSResource:
    """Classe base per tutte le risorse AWS"""
    def __init__(self, logical_id: str, name: str, resource_type: str):
        self.logical_id = logical_id  # ID logico nel template CloudFormation
        self.name = name              # Nome effettivo della risorsa
        self.resource_type = resource_type
        self.arn = None               # ARN della risorsa (se disponibile)
        self.connections = {
            'reads_from': [],    # ARN delle risorse da cui legge
            'writes_to': [],     # ARN delle risorse in cui scrive
            'triggers': [],      # ARN delle risorse che triggera
            'triggered_by': []   # ARN delle risorse che lo triggerano
        }
        # bus_arn → set di detail-type pubblicati (usato per riconciliazione finale)
        self.publishes_events: dict = {}

    def add_connection(self, connection_type: str, arn: str):
        """Aggiunge una connessione tramite ARN."""
        if arn and connection_type in self.connections and arn not in self.connections[connection_type]:
            self.connections[connection_type].append(arn)


class ECSService(AWSResource):
    """Servizio ECS (Elastic Container Service)"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::ECS::Service')
        self.cpu = None
        self.memory = None
        self.container_image = ''
        self.health_check_path = ''
        self.environment_vars = {}
        self.task_role_policy = None


class DynamoDBTable(AWSResource):
    """Tabella DynamoDB"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::DynamoDB::Table')
        self.hash_key = ''
        self.range_key = ''
        self.gsi = []
        self.stream = None
        self.ttl = None
        self.arn_param = None


class SQSQueue(AWSResource):
    """Coda SQS"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::SQS::Queue')
        self.visibility_timeout = None
        self.has_dlq = False
        self.has_alarm = False
        self.arn_param = None


class LambdaFunction(AWSResource):
    """Funzione Lambda"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::Lambda::Function')
        self.runtime = ''
        self.memory = None
        self.timeout = None
        self.handler = ''
        self.role_logical_id = None
        self.event_sources = []


class ExternalMicroservice(AWSResource):
    """Microservizio esterno"""
    def __init__(self, name: str, spec: str):
        super().__init__(name, name, 'External::Microservice')
        self.spec = spec
        self.spec_path = ''
        self.commit = ''
        # url: se spec sembra un url, usalo, altrimenti None
        self.url = spec if spec.startswith('http') else None
        self.arn = f'ext://{name}'


class EventBus(AWSResource):
    """Event Bus EventBridge (AWS::Events::EventBus)"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::Events::EventBus')


class EventBridgeRule(AWSResource):
    """Regola EventBridge (AWS::Events::Rule)"""
    def __init__(self, logical_id: str, name: str):
        super().__init__(logical_id, name, 'AWS::Events::Rule')
        self.event_bus_name = ''
        self.event_pattern  = {}   # dict con detail-type, detail, source, …
        self.target_arns    = []   # ARN dei target (code SQS, Lambda, …)
        self.target_ids     = []   # Id descrittivi dei target


# =============================================================================
# INFRASTRUCTURE GRAPH - Grafo delle risorse e relazioni
# =============================================================================

class InfrastructureGraph:
    """Gestisce il grafo completo dell'infrastruttura"""
    def __init__(self):
        self.ecs_services = {}
        self.dynamodb_tables = {}
        self.sqs_queues = {}
        self.lambda_functions = {}
        self.external_services = {}
        self.eventbuses = {}
        self.eventbus_rules = {}
        self.arn_map: dict = {}          # arn → AWSResource

    def register_arn(self, arn: str, resource: 'AWSResource'):
        """Registra un ARN nel mapping globale."""
        if arn:
            self.arn_map[arn] = resource

    def resolve(self, arn: str):
        """Risolve un ARN → risorsa."""
        return self.arn_map.get(arn)

    def resolved_connections(self, resource: 'AWSResource') -> dict:
        """Restituisce le connessioni con gli ARN risolti in oggetti risorsa."""
        return {
            conn_type: [self.arn_map[arn] for arn in arns if arn in self.arn_map]
            for conn_type, arns in resource.connections.items()
        }

    def add_ecs_service(self, service: ECSService):
        self.ecs_services[service.logical_id] = service
        self.register_arn(service.arn, service)

    def add_dynamodb_table(self, table: DynamoDBTable):
        self.dynamodb_tables[table.logical_id] = table
        self.register_arn(table.arn, table)

    def add_sqs_queue(self, queue: SQSQueue):
        self.sqs_queues[queue.logical_id] = queue
        self.register_arn(queue.arn, queue)

    def add_lambda_function(self, func: LambdaFunction):
        self.lambda_functions[func.logical_id] = func
        self.register_arn(func.arn, func)

    def add_external_service(self, service: ExternalMicroservice):
        self.external_services[service.name] = service
        self.register_arn(service.arn, service)

    def add_eventbus(self, bus: 'EventBus'):
        self.eventbuses[bus.logical_id] = bus
        self.register_arn(bus.arn, bus)

    def add_eventbus_rule(self, rule: 'EventBridgeRule'):
        self.eventbus_rules[rule.logical_id] = rule
        self.register_arn(rule.arn, rule)
