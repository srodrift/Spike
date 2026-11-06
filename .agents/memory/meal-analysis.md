---
name: Latency-bounded meal analysis
description: Why Spike uses constrained AI responses and low-latency generation.
---
Meal analysis must fit the user's ten-second fallback. Use strict structured responses rather than trusting JSON-mode prompts for enum casing, required fields, and array bounds.

**Why:** JSON mode produced schema-invalid meal output, and default model reasoning exceeded the short interaction budget during initial integration.

**How to apply:** Preserve the low-latency reasoning setting and strict schema when changing models or response contracts; keep the browser timeout and text fallback.
