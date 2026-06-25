import re


# =============================================================================
# GITHUB FETCHER - Download file da repository GitHub
# =============================================================================

class GitHubFetcher:
    """Gestisce il download dei file da GitHub"""

    @staticmethod
    def parse_repo_url(url: str):
        """Estrae owner e repo dall'URL"""
        pattern = r'github\.com/([^/]+)/([^/]+?)(?:\.git)?(?:/|$)'
        match = re.search(pattern, url)
        if match:
            return match.group(1), match.group(2)
        return None, None

    @staticmethod
    def fetch_file(owner: str, repo: str, path: str, branch: str = 'develop'):
        """Scarica un singolo file da GitHub"""
        import urllib.request
        import urllib.error

        url = f'https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}'
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                content = response.read().decode('utf-8')
                return content
        except urllib.error.HTTPError as e:
            if e.code != 404:
                print(f"  ✗ Errore HTTP {e.code}: {path}")
            return None
        except Exception as e:
            print(f"  ✗ Errore: {path} - {e}")
            return None
