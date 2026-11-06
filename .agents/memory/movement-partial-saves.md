---
name: Partial movement saves
description: Safety policy when movement answers save but the related meal-history update fails.
---

Keep successfully saved safety answers active if updating meal history fails. Hide incompatible movement plans and distinguish the successful safety save from the failed history update. Offer a retry rather than rolling back a restriction.

**Why:** These are separate local-storage writes. Rolling back a newly reported restriction to preserve a previous plan would prioritize historical progress over safety. Week must not pretend that failed history writes succeeded.

**How to apply:** When changing movement-save flows, preserve the partial-save distinction and a recovery path after reload. While cleanup is pending for the open meal, retry it before allowing another safety-answer change that might expose its old progress.
