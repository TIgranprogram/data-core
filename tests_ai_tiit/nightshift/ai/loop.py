class AILoop:
    def __init__(self, client):
        self.client = client
    def process(self, issue):
        return {"status": "done"}