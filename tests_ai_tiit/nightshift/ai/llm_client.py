import urllib.request, json

class LLMClient:
    def __init__(self, base_url="http://localhost:1235/v1", model=None, timeout=30):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def models(self):
        try:
            req = urllib.request.urlopen(f"{self.base_url}/models", timeout=self.timeout)
            return json.loads(req.read()).get("data", [])
        except Exception:
            return []

    def chat(self, messages, temperature=0.2, max_tokens=512):
        model = self.model or (self.models()[0]["id"] if self.models() else "default")
        payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
        req = urllib.request.Request(f"{self.base_url}/chat/completions", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        try:
            res = urllib.request.urlopen(req, timeout=self.timeout)
            data = json.loads(res.read())
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            return None