import json
from typing import Dict, List, Optional, Tuple

from cfn_parser import CloudFormationParser
from github_fetcher import GitHubFetcher
from models import ExternalMicroservice, InfrastructureGraph
from pom_parser import PomParser


class MultiRepoGraphAnalyzer:
    """Costruisce un InfrastructureGraph combinando più repository.

    Pipeline:
    1) Parse CFN (storage.yml + microservice.yml) per ogni repo
    2) Parse pom.xml per raccogliere dipendenze REST tra microservizi
    3) reconcile_connections() finale (CFN + REST)
    """

    def __init__(self):
        self.fetcher = GitHubFetcher()
        self.pom_parser = PomParser()
        self.graph = InfrastructureGraph()
        self.pending_rest_calls: List[Dict[str, str]] = []
        self.repo_to_ecs_arns: Dict[str, List[str]] = {}
        self.repo_to_all_arns: Dict[str, List[str]] = {}
        self.repo_to_owner: Dict[str, str] = {}

    @staticmethod
    def _norm(value: str) -> str:
        return str(value or "").strip().lower()

    def _find_ecs_for_repo(self, repo_name: str) -> List[str]:
        norm_repo = self._norm(repo_name)
        if norm_repo in self.repo_to_ecs_arns:
            return self.repo_to_ecs_arns[norm_repo]

        matches = []
        for svc in self.graph.ecs_services.values():
            svc_name = self._norm(svc.name)
            if not svc.arn:
                continue
            if svc_name == norm_repo or norm_repo in svc_name or svc_name in norm_repo:
                matches.append(svc.arn)
        return matches

    def _extract_target_repo_name(self, dep) -> str:
        """Ricava il nome repo da una dipendenza POM (priorita' URL GitHub)."""
        if dep.url and "github.com/" in dep.url:
            parts = dep.url.rstrip("/").split("/")
            if len(parts) >= 2:
                return parts[-1]

        if dep.spec and "raw.githubusercontent.com/" in dep.spec:
            parts = dep.spec.split("/")
            # .../owner/repo/<ref>/path
            if len(parts) >= 6:
                return parts[4]

        return dep.name

    def _fetch_first(self, owner: str, repo: str, paths: List[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        for path in paths:
            for branch in ("main", "develop", "master"):
                content = self.fetcher.fetch_file(owner, repo, path, branch)
                if content is not None:
                    return path, content, branch
        return None, None, None

    def _load_default_params(self, parser: CloudFormationParser):
        try:
            with open("default_params.json", "r", encoding="utf-8") as f:
                defaults = json.load(f)
            parser.load_params(defaults)
        except Exception:
            # In ambiente browser il file potrebbe non essere disponibile.
            pass

    def _current_arn_set(self) -> set:
        return {r.arn for r in self._all_resources() if r.arn}

    def _analyze_repo(self, owner: str, repo: str):
        repo_key = self._norm(repo)
        self.repo_to_owner[repo_key] = owner
        print(f"\n📦 Repo: {owner}/{repo}")

        before = self._current_arn_set()

        parser = CloudFormationParser(graph=self.graph)
        self._load_default_params(parser)
        parser.load_params_github(owner, repo)

        existing_ecs = set(self.graph.ecs_services.keys())

        storage_path, storage, storage_branch = self._fetch_first(owner, repo, ["scripts/aws/cfn/storage.yml"])
        micro_path, micro, micro_branch = self._fetch_first(owner, repo, ["scripts/aws/cfn/microservice.yml"])

        if storage:
            print("  🗄️ parsing storage.yml")
            parser.process_template(storage, source_file=storage_path, source_branch=storage_branch)
        else:
            print("  ℹ️ storage.yml non trovato")

        if micro:
            print("  🚀 parsing microservice.yml")
            parser.process_template(micro, source_file=micro_path, source_branch=micro_branch)
        else:
            print("  ℹ️ microservice.yml non trovato")

        new_ecs = [
            self.graph.ecs_services[lid]
            for lid in self.graph.ecs_services
            if lid not in existing_ecs and self.graph.ecs_services[lid].arn
        ]

        if new_ecs:
            self.repo_to_ecs_arns[repo_key] = [svc.arn for svc in new_ecs]
            print(f"  ✓ ECS trovati per {repo}: {', '.join(svc.name for svc in new_ecs)}")
        else:
            print("  ⚠️ Nessun ECS estratto dal CFN")

        pom_path, pom_content, _ = self._fetch_first(owner, repo, ["pom.xml"])
        if not pom_content:
            print("  ℹ️ pom.xml non trovato")
            return

        deps = self.pom_parser.extract_dependencies(pom_content)
        source_arns = self.repo_to_ecs_arns.get(repo_key, [])

        if not source_arns:
            print("  ℹ️ dipendenze POM rilevate ma nessun ECS sorgente da collegare")
            return

        for dep in deps:
            target_repo = self._extract_target_repo_name(dep)
            for source_arn in source_arns:
                self.pending_rest_calls.append({
                    "source_arn": source_arn,
                    "target_repo": self._norm(target_repo),
                    "dep_name": dep.name,
                    "dep_spec": dep.spec,
                    "dep_spec_path": dep.spec_path,
                    "dep_commit": dep.commit,
                })

        print(f"  ✓ dipendenze POM raccolte: {len(deps)} ({pom_path})")

        after = self._current_arn_set()
        new_arns = list(after - before)
        if new_arns:
            existing = self.repo_to_all_arns.get(repo_key, [])
            self.repo_to_all_arns[repo_key] = existing + [a for a in new_arns if a not in existing]

    def _get_or_create_external(self, target_repo: str, dep_info: Dict[str, str]) -> ExternalMicroservice:
        existing = self.graph.external_services.get(target_repo)
        if existing:
            return existing

        spec = dep_info.get("dep_spec") or ""
        ext = ExternalMicroservice(target_repo, spec)
        ext.spec_path = dep_info.get("dep_spec_path") or ""
        ext.commit = dep_info.get("dep_commit") or ""
        self.graph.add_external_service(ext)
        return ext

    def _reconcile_rest_connections(self):
        print("\n🔗 Riconciliazione chiamate REST...")
        linked = 0

        for call in self.pending_rest_calls:
            source = self.graph.resolve(call["source_arn"])
            if not source:
                continue

            targets = self._find_ecs_for_repo(call["target_repo"])
            if targets:
                for target_arn in targets:
                    target = self.graph.resolve(target_arn)
                    if not target:
                        continue
                    source.add_connection("calls", target_arn)
                    linked += 1
                continue

            ext = self._get_or_create_external(call["target_repo"], call)
            source.add_connection("calls", ext.arn)
            linked += 1

        print(f"  ✓ collegamenti REST riconciliati: {linked}")

    def reconcile_connections(self):
        """Riconcilia tutte le connessioni del grafo: CFN + REST."""
        cfn = CloudFormationParser(graph=self.graph)
        cfn.reconcile_connections()
        self._reconcile_rest_connections()

    def _all_resources(self):
        return [
            *self.graph.ecs_services.values(),
            *self.graph.lambda_functions.values(),
            *self.graph.sqs_queues.values(),
            *self.graph.dynamodb_tables.values(),
            *self.graph.eventbuses.values(),
            *self.graph.eventbus_rules.values(),
            *self.graph.external_services.values(),
        ]

    def _resource_type_label(self, res) -> str:
        t = getattr(res, "resource_type", "")
        if t == "AWS::ECS::Service":
            return "ecs"
        if t == "AWS::Lambda::Function":
            return "lambda"
        if t == "AWS::SQS::Queue":
            return "sqs"
        if t == "AWS::DynamoDB::Table":
            return "dynamodb"
        if t == "AWS::Events::EventBus":
            return "eventbus"
        if t == "AWS::Events::Rule":
            return "eventrule"
        if t == "External::Microservice":
            return "external"
        return "resource"

    def _build_graph_payload(self) -> Dict:
        nodes = []
        edges = []
        seen_edges = set()

        # Build arn → repo reverse map
        arn_to_repo: Dict[str, str] = {}
        for repo_key, arns in self.repo_to_all_arns.items():
            for arn in arns:
                arn_to_repo[arn] = repo_key
        for ext in self.graph.external_services.values():
            if ext.arn:
                arn_to_repo[ext.arn] = ext.name

        resources = self._all_resources()
        for res in resources:
            if not res.arn:
                continue
            repo_key = arn_to_repo.get(res.arn, "unknown")
            owner = self.repo_to_owner.get(repo_key)
            node = {
                "id": res.arn,
                "label": res.name,
                "type": self._resource_type_label(res),
                "resourceType": res.resource_type,
                "repo": repo_key,
            }
            if owner and repo_key and repo_key != "unknown":
                node["owner"] = owner
                node["repoUrl"] = f"https://github.com/{owner}/{repo_key}"
                src = getattr(res, "source", None)
                if src and src.get("file") and src.get("start"):
                    branch = src.get("branch") or "develop"
                    start = src.get("start")
                    end = src.get("end")
                    frag = f"#L{start}" + (f"-L{end}" if end and end != start else "")
                    node["sourceUrl"] = (
                        f"https://github.com/{owner}/{repo_key}/blob/"
                        f"{branch}/{src['file']}{frag}"
                    )
                    node["source"] = {
                        "file": src["file"],
                        "branch": branch,
                        "start": start,
                        "end": end,
                    }
            nodes.append(node)

        edge_map = {
            "reads_from":  "reads",
            "writes_to":   "writes",
            "triggers":    "triggers",
            "triggered_by":"triggered_by",
            "calls":       "calls",
        }

        for res in resources:
            if not res.arn:
                continue
            for conn_name, relation in edge_map.items():
                for target_arn in res.connections.get(conn_name, []):
                    if not target_arn:
                        continue
                    key = (res.arn, target_arn, relation)
                    if key in seen_edges:
                        continue
                    seen_edges.add(key)
                    edges.append({
                        "from": res.arn,
                        "to": target_arn,
                        "relation": relation,
                    })

        return {
            "nodes": nodes,
            "edges": edges,
            "analyzed_repos": list(self.repo_to_all_arns.keys()),
        }

    @staticmethod
    def build_adjacency_csv(
        nodes: List[Dict], edges: List[Dict]
    ) -> str:
        """Costruisce una matrice di adiacenza in formato CSV.

        - Le intestazioni (prima riga e prima colonna) sono i nodi.
        - La cella [riga][colonna] contiene la/le relazione/i dell'arco
          orientato riga -> colonna, se presente (relazioni multiple unite
          con ';'); stringa vuota se non esiste alcun arco.
        """
        import csv as _csv
        import io as _io

        ids = [n.get("id") for n in nodes if n.get("id")]
        label_of = {
            n["id"]: (n.get("label") or n["id"])
            for n in nodes
            if n.get("id")
        }
        id_set = set(ids)

        # from -> { to -> "rel1;rel2" }
        matrix: Dict[str, Dict[str, str]] = {}
        for e in edges:
            src = e.get("from")
            dst = e.get("to")
            rel = e.get("relation", "")
            if src not in id_set or dst not in id_set:
                continue
            row = matrix.setdefault(src, {})
            row[dst] = f"{row[dst]};{rel}" if dst in row else rel

        buf = _io.StringIO()
        writer = _csv.writer(buf, lineterminator="\r\n")
        writer.writerow([""] + [label_of[i] for i in ids])
        for src in ids:
            row = matrix.get(src, {})
            writer.writerow([label_of[src]] + [row.get(dst, "") for dst in ids])

        return buf.getvalue()

    def analyze(self, repo_list: List[Dict[str, str]]) -> Dict:
        print("\n============================================================")
        print("🔍 ANALISI MULTI-REPO")
        print("============================================================")

        self.graph = InfrastructureGraph()
        self.pending_rest_calls = []
        self.repo_to_ecs_arns = {}
        self.repo_to_all_arns = {}
        self.repo_to_owner = {}

        valid = []
        for item in repo_list:
            owner = self._norm(item.get("owner"))
            repo = self._norm(item.get("repo"))
            if owner and repo:
                valid.append({"owner": owner, "repo": repo})

        for item in valid:
            self._analyze_repo(item["owner"], item["repo"])

        self.reconcile_connections()

        graph_payload = self._build_graph_payload()

        calls = sum(len(r.connections.get("calls", [])) for r in self.graph.ecs_services.values())

        return {
            "repos": valid,
            "stats": {
                "repos": len(valid),
                "ecs": len(self.graph.ecs_services),
                "dynamo": len(self.graph.dynamodb_tables),
                "sqs": len(self.graph.sqs_queues),
                "lambda": len(self.graph.lambda_functions),
                "eventbuses": len(self.graph.eventbuses),
                "eventrules": len(self.graph.eventbus_rules),
                "external": len(self.graph.external_services),
                "rest_calls": calls,
            },
            "graph": graph_payload,
            "repo_to_ecs": self.repo_to_ecs_arns,
        }
