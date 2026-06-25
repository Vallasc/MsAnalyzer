import pyodide_http
from pyscript import window, document
from js import console
from github_fetcher import GitHubFetcher
from models import (
    AWSResource, ECSService, DynamoDBTable, SQSQueue,
    LambdaFunction, ExternalMicroservice, InfrastructureGraph,
)
from cfn_parser import CloudFormationParser
from pom_parser import PomParser

# Patch HTTP per usare fetch del browser
pyodide_http.patch_all()

print("🔬 Microservice Analyzer inizializzato!\n")



# =============================================================================
# MICROSERVICE ANALYZER - Orchestratore principale
# =============================================================================

class MicroserviceAnalyzer:
    """Analizzatore principale del microservizio"""
    
    def __init__(self):
        self.fetcher = GitHubFetcher()
        self.cfn_parser = CloudFormationParser()
        self.pom_parser = PomParser()
    
    def analyze(self, repo_url):
        """Esegue l'analisi completa del microservizio"""
        print(f"\n{'='*60}")
        print(f"🔍 ANALISI MICROSERVIZIO")
        print(f"{'='*60}\n")
        
        # Resetta il parser per una nuova analisi
        self.cfn_parser = CloudFormationParser()
        
        owner, repo = self.fetcher.parse_repo_url(repo_url)
        if not owner or not repo:
            print("✗ URL repository non valido")
            return None
        
        print(f"📦 Repository: {owner}/{repo}\n")
        
        # Step 1: Download dei file
        print("📥 Download files...")
        files = self._download_files(owner, repo)
        if not files:
            return None
        
        # Step 2: Carica parametri CloudFormation
        print("\n⚙️ Caricamento parametri CloudFormation...")
        self.cfn_parser.load_params_github(owner, repo, 'develop')
        
        # Step 3: Parse storage.yml — outputs diventano params per il template successivo
        print("\n🗄️ Analisi storage.yml...")
        if 'storage.yml' in files:
            self.cfn_parser.process_template(files['storage.yml'])
        
        # Step 4: Parse microservice.yml — usa i params derivati da storage.yml
        print("\n🚀 Analisi microservice.yml...")
        if 'microservice.yml' in files:
            self.cfn_parser.process_template(files['microservice.yml'])
        
        # Step 5: Riconcilia tutti i collegamenti (Lambda←SQS, Rule→Target, Publisher→Rule)
        self.cfn_parser.reconcile_connections()
        
        # Step 7: Estrai dipendenze esterne da pom.xml
        print("\n📦 Analisi dipendenze Maven...")
        if 'pom.xml' in files:
            external_deps = self.pom_parser.extract_dependencies(files['pom.xml'])
            for dep in external_deps:
                self.cfn_parser.graph.add_external_service(dep)
                print(f"    ✓ External: {dep.name}")
            
            # Collega ECS ai servizi esterni
            for ecs in self.cfn_parser.graph.ecs_services.values():
                for ext in external_deps:
                    ecs.add_connection('writes_to', ext.arn)
        
        # Costruisci risultato
        result = self._build_result(repo, repo_url, files)
        
        self._print_summary(result)
        
        return result
    
    def _download_files(self, owner, repo):
        """Scarica i file necessari"""
        files = {}
        
        pom = self.fetcher.fetch_file(owner, repo, 'pom.xml', 'main')
        if pom:
            files['pom.xml'] = pom
        
        microservice = self.fetcher.fetch_file(owner, repo, 'scripts/aws/cfn/microservice.yml', 'main')
        if microservice:
            files['microservice.yml'] = microservice
        
        storage = self.fetcher.fetch_file(owner, repo, 'scripts/aws/cfn/storage.yml', 'main')
        if storage:
            files['storage.yml'] = storage
        
        if not files:
            print("\n✗ Nessun file scaricato")
            return None
        
        print(f"\n✓ Scaricati {len(files)} file")
        return files
    
    def _build_result(self, repo_name, repo_url, files):
        """Costruisce l'oggetto risultato"""
        graph = self.cfn_parser.graph
        
        return {
            'repoName': repo_name,
            'repoUrl': repo_url,
            'files': files,
            'graph': graph,
            'resources': {
                'ecs': list(graph.ecs_services.values()),
                'dynamodb': list(graph.dynamodb_tables.values()),
                'sqs': list(graph.sqs_queues.values()),
                'lambda': list(graph.lambda_functions.values()),
                'external': list(graph.external_services.values())
            },
            'stats': {
                'ecsServices': len(graph.ecs_services),
                'dynamoTables': len(graph.dynamodb_tables),
                'sqsQueues': len(graph.sqs_queues),
                'lambdas': len(graph.lambda_functions),
                'dependencies': len(graph.external_services)
            }
        }
    
    def _print_summary(self, result):
        """Stampa il riepilogo dell'analisi"""
        print(f"\n{'='*60}")
        print(f"✅ ANALISI COMPLETATA")
        print(f"{'='*60}")
        print(f"📊 Risorse trovate:")
        print(f"  • ECS Services: {result['stats']['ecsServices']}")
        print(f"  • DynamoDB: {result['stats']['dynamoTables']} tabelle")
        print(f"  • SQS: {result['stats']['sqsQueues']} code")
        print(f"  • Lambda: {result['stats']['lambdas']} funzioni")
        print(f"  • External: {result['stats']['dependencies']} microservizi")
        
        print(f"\n🔗 Collegamenti rilevati:")
        for ecs in result['resources']['ecs']:
            print(f"  ECS {ecs.name}:")
            for res in ecs.connections['reads_from']:
                if isinstance(res, DynamoDBTable):
                    print(f"    ← legge DynamoDB: {res.name}")
                elif isinstance(res, SQSQueue):
                    print(f"    ← riceve SQS: {res.name}")
            for res in ecs.connections['writes_to']:
                if isinstance(res, DynamoDBTable):
                    print(f"    → scrive DynamoDB: {res.name}")
                elif isinstance(res, SQSQueue):
                    print(f"    → invia SQS: {res.name}")
                elif isinstance(res, ExternalMicroservice):
                    print(f"    → REST: {res.name}")
        
        for func in result['resources']['lambda']:
            if func.connections['triggered_by'] or func.connections['writes_to']:
                print(f"  Lambda {func.name}:")
                for res in func.connections['triggered_by']:
                    print(f"    ← triggered: {res.name}")
                for res in func.connections['writes_to']:
                    print(f"    → scrive: {res.name}")
        
        print(f"{'='*60}\n")


# =============================================================================
# UI MANAGER - Gestione interfaccia utente
# =============================================================================

class UIManager:
    """Gestisce l'interfaccia utente"""
    
    @staticmethod
    def create_tabs():
        """Crea i tab di navigazione"""
        active = "tab-btn tab-active px-4 py-2 rounded text-sm font-semibold transition-colors"
        inactive = "tab-btn tab-inactive px-4 py-2 rounded text-sm font-semibold transition-colors"
        tabs_html = f'''
            <button class="{active}" data-tab="overview" onclick="switchTab('overview')">📊 Overview</button>
            <button class="{inactive}" data-tab="architecture" onclick="switchTab('architecture')">🏗️ Architettura</button>
            <button class="{inactive}" data-tab="dynamo" onclick="switchTab('dynamo')">💾 DynamoDB</button>
            <button class="{inactive}" data-tab="sqs" onclick="switchTab('sqs')">📨 SQS</button>
            <button class="{inactive}" data-tab="lambda" onclick="switchTab('lambda')">⚡ Lambda</button>
            <button class="{inactive}" data-tab="dependencies" onclick="switchTab('dependencies')">🔗 Dipendenze</button>
            <button class="{inactive}" data-tab="files" onclick="switchTab('files')">📄 Files</button>
        '''
        document.getElementById('tabs').innerHTML = tabs_html
    
    @staticmethod
    def update_stats(stats):
        """Aggiorna le statistiche"""
        card = "stat-card text-white p-4 rounded-lg text-center"
        stats_html = f'''
            <div class="{card}">
                <div class="text-3xl font-bold mb-0.5">{stats.get('ecsServices', 0)}</div>
                <div class="text-xs opacity-80 uppercase tracking-wide">ECS Services</div>
            </div>
            <div class="{card}">
                <div class="text-3xl font-bold mb-0.5">{stats.get('dynamoTables', 0)}</div>
                <div class="text-xs opacity-80 uppercase tracking-wide">DynamoDB</div>
            </div>
            <div class="{card}">
                <div class="text-3xl font-bold mb-0.5">{stats.get('sqsQueues', 0)}</div>
                <div class="text-xs opacity-80 uppercase tracking-wide">Code SQS</div>
            </div>
            <div class="{card}">
                <div class="text-3xl font-bold mb-0.5">{stats.get('lambdas', 0)}</div>
                <div class="text-xs opacity-80 uppercase tracking-wide">Lambda</div>
            </div>
            <div class="{card}">
                <div class="text-3xl font-bold mb-0.5">{stats.get('dependencies', 0)}</div>
                <div class="text-xs opacity-80 uppercase tracking-wide">Esterni</div>
            </div>
        '''
        document.getElementById('stats').innerHTML = stats_html
    
    @staticmethod
    def update_overview(data):
        """Aggiorna il tab overview"""
        ecs_html = ''
        for ecs in data['resources']['ecs']:
            ecs_html += f'<p>🚀 <code>{ecs.name}</code></p>'
        
        connections_html = '<h4 class="font-semibold text-slate-700 mb-2 text-sm">Collegamenti rilevati:</h4>'
        for ecs in data['resources']['ecs']:
            if ecs.connections['reads_from'] or ecs.connections['writes_to']:
                connections_html += f'<p class="font-semibold text-slate-700 mt-2 text-sm">{ecs.name}:</p>'
                for res in ecs.connections['reads_from']:
                    icon = '💾' if isinstance(res, DynamoDBTable) else '📨'
                    connections_html += f'<p class="ml-5 text-sm text-gray-600">← {icon} {res.name}</p>'
                for res in ecs.connections['writes_to']:
                    if isinstance(res, DynamoDBTable):
                        connections_html += f'<p class="ml-5 text-sm text-gray-600">→ 💾 {res.name}</p>'
                    elif isinstance(res, SQSQueue):
                        connections_html += f'<p class="ml-5 text-sm text-gray-600">→ 📨 {res.name}</p>'
                    elif isinstance(res, ExternalMicroservice):
                        connections_html += f'<p class="ml-5 text-sm text-gray-600">→ 🌐 {res.name}</p>'
        
        for func in data['resources']['lambda']:
            if func.connections['triggered_by'] or func.connections['writes_to']:
                connections_html += f'<p class="font-semibold text-slate-700 mt-2 text-sm">{func.name}:</p>'
                for res in func.connections['triggered_by']:
                    connections_html += f'<p class="ml-5 text-sm text-gray-600">← 📨 {res.name}</p>'
                for res in func.connections['writes_to']:
                    connections_html += f'<p class="ml-5 text-sm text-gray-600">→ 📨 {res.name}</p>'
        
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        p = "text-slate-500 my-1 text-sm"
        code = "bg-white border border-slate-200 px-1.5 rounded text-slate-700 text-xs font-mono"
        html = f'''
            <h2 class="text-lg font-semibold text-slate-800 mb-4">📋 Riepilogo Architettura</h2>
            <div class="{card}">
                <h3 class="{h3}">Repository</h3>
                <p class="{p}"><strong>Nome:</strong> <code class="{code}">{data['repoName']}</code></p>
                <p class="{p}"><strong>URL:</strong> <code class="{code}">{data['repoUrl']}</code></p>
            </div>
            <div class="{card}">
                <h3 class="{h3}">ECS Services (Microservizio principale)</h3>
                {ecs_html}
            </div>
            <div class="{card}">
                <h3 class="{h3}">Risorse AWS</h3>
                <p class="{p}">💾 <strong>DynamoDB:</strong> {data['stats']['dynamoTables']} tabelle</p>
                <p class="{p}">📨 <strong>SQS:</strong> {data['stats']['sqsQueues']} code</p>
                <p class="{p}">⚡ <strong>Lambda:</strong> {data['stats']['lambdas']} funzioni</p>
            </div>
            <div class="{card}">
                {connections_html}
            </div>
        '''
        document.getElementById('tab-overview').innerHTML = html
    
    @staticmethod
    def update_dynamodb(tables):
        """Aggiorna il tab DynamoDB"""
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        p = "text-slate-500 my-1 text-sm"
        code = "bg-white border border-slate-200 px-1.5 rounded text-slate-700 text-xs font-mono"
        tables_html = ''
        for table in tables:
            gsi_info = f'<p class="{p}"><strong>GSI:</strong> {", ".join(table.gsi)}</p>' if table.gsi else ''
            stream_info = f'<p class="{p}">📡 <strong>Stream:</strong> {table.stream}</p>' if table.stream else ''
            ttl_info = f'<p class="{p}">⏱️ <strong>TTL:</strong> {table.ttl}</p>' if table.ttl else ''
            
            tables_html += f'''
                <div class="{card}">
                    <h3 class="{h3}">💾 {table.name}</h3>
                    <p class="{p}"><strong>Hash Key:</strong> <code class="{code}">{table.hash_key or 'N/A'}</code></p>
                    <p class="{p}"><strong>Range Key:</strong> <code class="{code}">{table.range_key or 'N/A'}</code></p>
                    {gsi_info}
                    {stream_info}
                    {ttl_info}
                </div>
            '''
        
        html = f'<h2 class="text-lg font-semibold text-slate-800 mb-4">💾 Tabelle DynamoDB</h2>{tables_html}'
        document.getElementById('tab-dynamo').innerHTML = html
    
    @staticmethod
    def update_sqs(queues):
        """Aggiorna il tab SQS"""
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        p = "text-slate-500 my-1 text-sm"
        code = "bg-white border border-slate-200 px-1.5 rounded text-slate-700 text-xs font-mono"
        queues_html = ''
        for queue in queues:
            dlq_info = f'<p class="{p}">☠️ <strong>DLQ:</strong> Abilitata</p>' if queue.has_dlq else ''
            alarm_info = f'<p class="{p}">🔔 <strong>Allarmi:</strong> Configurati</p>' if queue.has_alarm else ''
            
            triggers = [r.name for r in queue.connections.get('triggers', [])]
            
            queues_html += f'''
                <div class="{card}">
                    <h3 class="{h3}">📨 {queue.name}</h3>
                    <p class="{p}"><strong>Visibility Timeout:</strong> <code class="{code}">{queue.visibility_timeout or 'Default'}</code></p>
                    {dlq_info}
                    {alarm_info}
                    {f'<p class="{p}"><strong>Triggera:</strong> ' + ", ".join(triggers) + '</p>' if triggers else ''}
                </div>
            '''
        
        html = f'<h2 class="text-lg font-semibold text-slate-800 mb-4">📨 Code SQS</h2>{queues_html}'
        document.getElementById('tab-sqs').innerHTML = html
    
    @staticmethod
    def update_lambda(lambdas):
        """Aggiorna il tab Lambda"""
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        p = "text-slate-500 my-1 text-sm"
        code = "bg-white border border-slate-200 px-1.5 rounded text-slate-700 text-xs font-mono"
        lambdas_html = ''
        for lam in lambdas:
            triggers = [t.name for t in lam.connections.get('triggered_by', [])]
            trigger_info = f'<p class="{p}">🎯 <strong>Triggered by:</strong> {", ".join(triggers)}</p>' if triggers else ''
            
            writes = [t.name for t in lam.connections.get('writes_to', [])]
            writes_info = f'<p class="{p}">📤 <strong>Scrive su:</strong> {", ".join(writes)}</p>' if writes else ''
            
            lambdas_html += f'''
                <div class="{card}">
                    <h3 class="{h3}">⚡ {lam.name}</h3>
                    <p class="{p}"><strong>Runtime:</strong> <code class="{code}">{lam.runtime or 'N/A'}</code></p>
                    <p class="{p}"><strong>Memory:</strong> <code class="{code}">{lam.memory or 'N/A'} MB</code></p>
                    <p class="{p}"><strong>Timeout:</strong> <code class="{code}">{lam.timeout or 'N/A'}s</code></p>
                    {trigger_info}
                    {writes_info}
                </div>
            '''
        
        html = f'<h2 class="text-lg font-semibold text-slate-800 mb-4">⚡ Lambda Functions</h2>{lambdas_html}'
        document.getElementById('tab-lambda').innerHTML = html
    
    @staticmethod
    def update_dependencies(deps):
        """Aggiorna il tab dipendenze"""
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        p = "text-slate-500 my-1 text-sm"
        code = "bg-white border border-slate-200 px-1.5 rounded text-slate-700 text-xs font-mono"
        deps_html = ''
        for dep in deps:
            deps_html += f'''
                <div class="{card}">
                    <h3 class="{h3}">🌐 {dep.name}</h3>
                    <p class="{p}"><strong>Repository:</strong> <a href="{dep.url}" target="_blank" class="text-brand underline"><code class="{code}">{dep.url}</code></a></p>
                    {f'<p class="{p}"><strong>Commit/Tag:</strong> <code class="{code}">' + dep.commit + '</code></p>' if dep.commit else ''}
                    <p class="{p}"><strong>OpenAPI Spec:</strong> <code class="{code}">{dep.spec_path or 'N/A'}</code></p>
                </div>
            '''
        
        html = f'<h2 class="text-lg font-semibold text-slate-800 mb-4">🌐 Microservizi Esterni (REST)</h2>{deps_html}'
        document.getElementById('tab-dependencies').innerHTML = html
    
    @staticmethod
    def update_files(files):
        """Aggiorna il tab files"""
        card = "bg-slate-50 border-l-4 card-border p-4 mb-3 rounded"
        h3 = "text-brand font-semibold mb-2 text-sm"
        files_html = ''
        for name, content in files.items():
            preview = content[:2000] + ('...' if len(content) > 2000 else '')
            files_html += f'''
                <div class="{card}">
                    <h3 class="{h3}">📄 {name}</h3>
                    <div class="mt-2 bg-gray-900 text-gray-300 p-4 rounded-lg overflow-x-auto max-h-72 overflow-y-auto">
                        <pre class="text-xs whitespace-pre-wrap break-words">{preview}</pre>
                    </div>
                </div>
            '''
        
        html = f'<h2 class="text-lg font-semibold text-slate-800 mb-4">📄 Files Scaricati</h2>{files_html}'
        document.getElementById('tab-files').innerHTML = html
    
    @staticmethod
    def generate_vis_graph(data):
        """Genera dati per grafo vis.js (nodi + archi) con icone AWS."""
        repo_name = data.get('repoName', 'microservice')
        
        ecs_services = data['resources']['ecs']
        lambdas = data['resources']['lambda']
        sqs_queues = data['resources']['sqs']
        dynamodb_tables = data['resources']['dynamodb']
        external = data['resources']['external']
        
        nodes = []
        edges = []

        # Nodo centrale (microservizio)
        nodes.append({
            "id": "ms",
            "label": repo_name,
            "type": "microservice"
        })

        # ECS services
        for idx, ecs in enumerate(ecs_services):
            name = ecs.name.replace('pn-', '')
            node_id = f"ecs{idx}"
            nodes.append({
                "id": node_id,
                "label": name,
                "type": "ecs"
            })

        # Lambda functions
        for idx, lam in enumerate(lambdas):
            name = lam.name.replace('pn-', '').replace('-paper-tracker-', '')
            node_id = f"lambda{idx}"
            nodes.append({
                "id": node_id,
                "label": name,
                "type": "lambda"
            })

        # SQS queues
        for idx, queue in enumerate(sqs_queues):
            name = queue.name.replace('pn-', '')
            node_id = f"q{idx}"
            nodes.append({
                "id": node_id,
                "label": name,
                "type": "sqs"
            })

        # DynamoDB tables
        for idx, table in enumerate(dynamodb_tables):
            name = table.name.replace('pn-', '')
            node_id = f"db{idx}"
            nodes.append({
                "id": node_id,
                "label": name,
                "type": "dynamodb"
            })

        # External services
        for idx, ext in enumerate(external):
            name = ext.name
            node_id = f"ext{idx}"
            nodes.append({
                "id": node_id,
                "label": name,
                "type": "external"
            })

        # Collegamenti basati sulle relazioni estratte
        edges_added = set()
        
        for ecs_idx, ecs in enumerate(ecs_services):
            # ECS <-> DynamoDB, ECS <-> SQS, ECS -> External
            for res in ecs.connections.get('reads_from', []):
                if isinstance(res, DynamoDBTable):
                    try:
                        db_idx = dynamodb_tables.index(res)
                        key = (f"ecs{ecs_idx}", f"db{db_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"ecs{ecs_idx}",
                                "to": f"db{db_idx}",
                                "type": "dynamodb"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass
                elif isinstance(res, SQSQueue):
                    try:
                        q_idx = sqs_queues.index(res)
                        key = (f"q{q_idx}", f"ecs{ecs_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"q{q_idx}",
                                "to": f"ecs{ecs_idx}",
                                "type": "sqs"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass

            for res in ecs.connections.get('writes_to', []):
                if isinstance(res, SQSQueue):
                    try:
                        q_idx = sqs_queues.index(res)
                        key = (f"ecs{ecs_idx}", f"q{q_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"ecs{ecs_idx}",
                                "to": f"q{q_idx}",
                                "type": "sqs"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass
                elif isinstance(res, ExternalMicroservice):
                    try:
                        ext_idx = external.index(res)
                        key = (f"ecs{ecs_idx}", f"ext{ext_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"ecs{ecs_idx}",
                                "to": f"ext{ext_idx}",
                                "type": "external"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass

        for lam_idx, lam in enumerate(lambdas):
            # Lambda triggered by SQS
            for res in lam.connections.get('triggered_by', []):
                if isinstance(res, SQSQueue):
                    try:
                        q_idx = sqs_queues.index(res)
                        key = (f"q{q_idx}", f"lambda{lam_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"q{q_idx}",
                                "to": f"lambda{lam_idx}",
                                "type": "sqs"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass

            # Lambda -> SQS
            for res in lam.connections.get('writes_to', []):
                if isinstance(res, SQSQueue):
                    try:
                        q_idx = sqs_queues.index(res)
                        key = (f"lambda{lam_idx}", f"q{q_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"lambda{lam_idx}",
                                "to": f"q{q_idx}",
                                "type": "sqs"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass

            # Lambda -> DynamoDB
            for res in lam.connections.get('reads_from', []):
                if isinstance(res, DynamoDBTable):
                    try:
                        db_idx = dynamodb_tables.index(res)
                        key = (f"lambda{lam_idx}", f"db{db_idx}")
                        if key not in edges_added:
                            edges.append({
                                "from": f"lambda{lam_idx}",
                                "to": f"db{db_idx}",
                                "type": "dynamodb"
                            })
                            edges_added.add(key)
                    except ValueError:
                        pass

        graph = {"nodes": nodes, "edges": edges}

        print("\n" + "=" * 60)
        print("📊 GRAFO VIS.JS GENERATO:")
        print("=" * 60)
        print(graph)
        print("=" * 60 + "\n")

        return graph
    
    @staticmethod
    def update_architecture(data):
        """Aggiorna il tab architettura con grafo SVG"""
        graph = UIManager.generate_vis_graph(data)
        window.renderGraph(graph)


# =============================================================================
# MAIN - Entry point
# =============================================================================

analyzer = MicroserviceAnalyzer()


async def analyze_repo(event=None):
    """Funzione chiamata dal bottone HTML"""
    btn = document.getElementById('analyzeBtn')
    output = document.getElementById('output')
    repo_input = document.getElementById('repoUrl')
    results_section = document.getElementById('results')
    
    btn.disabled = True
    btn.textContent = '⏳ Analisi in corso...'
    output.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm">⏳ Scaricamento e analisi in corso...</div>'
    results_section.classList.add('hidden')
    
    try:
        repo_url = repo_input.value.strip()
        if not repo_url:
            output.innerHTML = '<p style="color: red;">❌ Inserisci un URL repository valido</p>'
            return
        
        result = analyzer.analyze(repo_url)
        
        if result:
            UIManager.create_tabs()
            
            output.innerHTML = '<p class="text-emerald-600 text-sm font-medium">✅ Analisi completata. Vedi i risultati qui sotto.</p>'
            results_section.classList.remove('hidden')
            
            UIManager.update_stats(result['stats'])
            UIManager.update_overview(result)
            UIManager.update_architecture(result)
            UIManager.update_dynamodb(result['resources']['dynamodb'])
            UIManager.update_sqs(result['resources']['sqs'])
            UIManager.update_lambda(result['resources']['lambda'])
            UIManager.update_dependencies(result['resources']['external'])
            UIManager.update_files(result['files'])
        else:
            output.innerHTML = '<p class="text-red-600 text-sm">❌ Errore durante l\'analisi</p>'
    
    except Exception as e:
        output.innerHTML = f'<p class="text-red-600 text-sm">❌ Errore: {e}</p>'
        console.error(str(e))
    
    finally:
        btn.disabled = False
        btn.textContent = '🚀 Analizza Microservizio'


window.analyze_repo = analyze_repo

print("✅ Pronto! Inserisci l'URL del repository e clicca 'Analizza'\n")
