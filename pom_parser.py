import re
from models import ExternalMicroservice


class PomParser:
    """Parser per file pom.xml Maven"""

    @staticmethod
    def extract_dependencies(pom_content):
        """Estrae i microservizi esterni chiamati via OpenAPI"""
        dependencies = []

        plugin_pattern = r'<execution>.*?<id>generate-client-(.*?)</id>.*?<inputSpec>(.*?)</inputSpec>.*?</execution>'
        matches = re.findall(plugin_pattern, pom_content, re.DOTALL)

        for client_id, input_spec in matches:
            name = client_id.strip()
            spec = input_spec.strip()

            github_match = re.search(r'github\.com/([^/]+)/([^/]+)/.*?/([^/]+)/(.+\.yaml)', spec)
            if github_match:
                owner, repo, commit_or_ref, spec_path = github_match.groups()
                service = ExternalMicroservice(name, f"https://github.com/{owner}/{repo}")
                service.commit = commit_or_ref
                service.spec_path = spec_path
                dependencies.append(service)
            elif 'http' in spec:
                service = ExternalMicroservice(name, spec)
                service.spec_path = spec
                dependencies.append(service)

        return dependencies
