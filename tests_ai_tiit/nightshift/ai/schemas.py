from pydantic import BaseModel

class IssueCard(BaseModel):
    id: str
    title: str
    priority: str = "minor"