"""
Autonomous voice agent planning micro-framework executed within Pyodide.

The orchestrator analyses user commands, categorises intent, and generates
step-by-step automation guidance that downstream systems can execute.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import List


@dataclass
class Step:
    title: str
    description: str
    tool: str | None = None


@dataclass
class Plan:
    summary: str
    category: str
    confidence: float
    steps: List[Step] = field(default_factory=list)
    recommended_tools: List[str] = field(default_factory=list)
    follow_ups: List[str] = field(default_factory=list)
    speech: str = ""


MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]


def orchestrate_command(command: str) -> dict:
    """Entry point exposed to the JavaScript host."""
    if not isinstance(command, str) or not command.strip():
        raise ValueError("A non-empty command string is required.")

    normalised = command.strip()
    plan = build_plan(normalised)
    payload = {
        "summary": plan.summary,
        "category": plan.category,
        "confidence": plan.confidence,
        "steps": [asdict(step) for step in plan.steps],
        "recommendedTools": plan.recommended_tools,
        "followUps": plan.follow_ups,
        "speech": plan.speech or plan.summary,
    }
    return payload


def build_plan(command: str) -> Plan:
    lower = command.lower()
    if "call" in lower:
        return call_plan(command)
    if "map" in lower or "direction" in lower or "navigate" in lower:
        return navigation_plan(command)
    if "appointment" in lower or "book" in lower or "schedule" in lower:
        return appointment_plan(command)

    return general_plan(command)


def call_plan(command: str) -> Plan:
    contact = extract_after_keyword(command, "call") or "specified contact"
    contact = contact.replace("my", "").strip().title()

    steps = [
        Step(
            title="Validate contact",
            description=f"Confirm {contact} is available in the contact graph with the latest phone number.",
            tool="CRM / Contacts API",
        ),
        Step(
            title="Initiate outbound call",
            description=f"Trigger a programmable voice call to {contact} using your telephony provider.",
            tool="Twilio Programmable Voice",
        ),
        Step(
            title="Log and summarise",
            description="Capture call metadata, duration, and summary notes back into the operating log.",
            tool="Notion / Airtable",
        ),
    ]

    plan = Plan(
        summary=f"Prepare and place a phone call to {contact}, then document the outcome.",
        category="Telephony",
        confidence=0.86,
        steps=steps,
        recommended_tools=[
            "Twilio Voice API",
            "Contact Directory",
            "Automation Runbook",
        ],
        follow_ups=[
            f"Would you like me to send a quick follow-up message to {contact} afterwards?",
            "Should I schedule a reminder to review the call notes later today?",
        ],
        speech=f"Standing by to connect you with {contact}. I will verify their number, dial out, and capture key notes.",
    )
    return plan


def navigation_plan(command: str) -> Plan:
    location = extract_location(command) or "the requested destination"
    steps = [
        Step(
            title="Resolve destination",
            description=f"Translate \"{location}\" into precise latitude and longitude coordinates.",
            tool="Google Maps Places API",
        ),
        Step(
            title="Pull live routing",
            description="Fetch optimal route based on real-time traffic and travel preferences.",
            tool="Google Directions API",
        ),
        Step(
            title="Launch navigation",
            description="Open the navigation client with turn-by-turn guidance and share ETA if required.",
            tool="Google Maps Deep Link",
        ),
    ]

    plan = Plan(
        summary=f"Locate {location}, calculate optimal directions, and start guided navigation.",
        category="Navigation",
        confidence=0.81,
        steps=steps,
        recommended_tools=[
            "Google Maps Platform",
            "Shortcuts Automation",
            "Contextual ETA Broadcast",
        ],
        follow_ups=[
            "Need me to share the live ETA with your family?",
            "Should I add this destination to your frequently visited list?",
        ],
        speech=f"I will map out the best path to {location}, spin up navigation, and can share ETA updates on request.",
    )
    return plan


def appointment_plan(command: str) -> Plan:
    venue = detect_service_provider(command) or "your requested provider"
    meeting_time = extract_time_phrase(command) or "the preferred time slot"
    meeting_date = extract_date_phrase(command) or "the desired date"

    steps = [
        Step(
            title="Check calendar availability",
            description=f"Scan personal and shared calendars around {meeting_date} at {meeting_time} to avoid conflicts.",
            tool="Google Calendar API",
        ),
        Step(
            title="Query provider availability",
            description=f"Contact {venue} via API, email, or phone to secure an appointment at the target time.",
            tool="Salon Booking API / Email Automation",
        ),
        Step(
            title="Confirm and notify",
            description="Log the appointment, send confirmations, and optionally set reminders across devices.",
            tool="Calendar + Notification Service",
        ),
    ]

    plan = Plan(
        summary=f"Coordinate a booking with {venue} for {meeting_date} at {meeting_time}, then sync reminders.",
        category="Scheduling",
        confidence=0.83,
        steps=steps,
        recommended_tools=[
            "Google Calendar",
            "Zapier / Make Scenario",
            "CRM Appointment Log",
        ],
        follow_ups=[
            "Do you want me to reserve travel time before and after the appointment?",
            "Should I notify trusted contacts about this booking?",
        ],
        speech=f"I will cross-check calendars, lock in the slot with {venue}, and drop confirmations into your inbox.",
    )
    return plan


def general_plan(command: str) -> Plan:
    steps = [
        Step(
            title="Clarify objective",
            description=f"Break down the intent behind “{command}” into measurable outcomes.",
            tool="LLM Intent Extraction",
        ),
        Step(
            title="Identify required systems",
            description="Map the objective to available integrations, APIs, or workflows that can execute the task.",
            tool="Automation Inventory",
        ),
        Step(
            title="Compose execution plan",
            description="Draft a sequenced action list, highlighting dependencies, fallbacks, and human approvals.",
            tool="Workflow Orchestrator",
        ),
    ]

    plan = Plan(
        summary=f"Decompose the request “{command}” into an actionable automation plan.",
        category="General Automation",
        confidence=0.65,
        steps=steps,
        recommended_tools=[
            "Knowledge Graph",
            "AI Orchestration Engine",
            "API Integrations",
        ],
        follow_ups=[
            "Provide more context or constraints to refine the plan.",
            "Should I execute the first step automatically once ready?",
        ],
        speech="Understood. I'll break that down into a structured plan and highlight the next best moves.",
    )
    return plan


def extract_after_keyword(command: str, keyword: str) -> str | None:
    regex = re.compile(rf"{keyword}\s+([a-zA-Z0-9\s'-]+)", re.IGNORECASE)
    match = regex.search(command)
    if not match:
        return None
    capture = match.group(1).strip()
    capture = re.split(r"[.,!?]", capture)[0].strip()
    return capture or None


def extract_location(command: str) -> str | None:
    patterns = [
        r"map[s]?\s+(?:of|for)?\s*(.+)",
        r"search\s+(.+)",
        r"navigate\s+(?:to)?\s*(.+)",
        r"direction[s]?\s+(?:to)?\s*(.+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, command, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            candidate = re.split(r"[.,!?]", candidate)[0]
            return candidate.strip()
    return None


def detect_service_provider(command: str) -> str | None:
    match = re.search(r"my\s+([a-zA-Z\s]+?)\s+(?:salon|doctor|dentist|therapist|trainer)", command, re.IGNORECASE)
    if match:
        return f"your {match.group(1).strip()} {detect_service_suffix(command)}".title()
    match = re.search(r"(salon|doctor|dentist|therapist|trainer)\b", command, re.IGNORECASE)
    if match:
        suffix = detect_service_suffix(command)
        return f"your {match.group(0)} {suffix}".strip().title()
    return None


def detect_service_suffix(command: str) -> str:
    if "salon" in command.lower():
        return "salon"
    if "doctor" in command.lower():
        return "clinic"
    if "dentist" in command.lower():
        return "practice"
    if "therapist" in command.lower():
        return "studio"
    if "trainer" in command.lower():
        return "training session"
    return "provider"


def extract_time_phrase(command: str) -> str | None:
    match = re.search(r"at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)", command, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    match = re.search(r"(\b(?:morning|afternoon|evening|noon)\b)", command, re.IGNORECASE)
    if match:
        return match.group(1).title()
    return None


def extract_date_phrase(command: str) -> str | None:
    match = re.search(r"on\s+(the\s+)?([0-9]{1,2}(?:st|nd|rd|th)?)\s+(?:of\s+)?([a-zA-Z]+)", command, re.IGNORECASE)
    if match:
        day = match.group(2)
        month = match.group(3)
        if month.lower() in MONTHS:
            return f"{day} {month.title()}"
    for month in MONTHS:
        pattern = re.compile(rf"([0-9]{{1,2}}(?:st|nd|rd|th)?)\s+{month}", re.IGNORECASE)
        match = pattern.search(command)
        if match:
            return f"{match.group(1)} {month.title()}"
    return None


__all__ = ["orchestrate_command"]
