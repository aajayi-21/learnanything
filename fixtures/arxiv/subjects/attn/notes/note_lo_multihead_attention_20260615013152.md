---
schema_version: 1
id: note_lo_multihead_attention_20260615013152
subjects:
  - attn
related_los:
  - lo_multihead_attention
related_concepts: []
source_type: learner_note
created_at: '2026-06-15T01:31:53Z'
updated_at: '2026-06-15T01:31:53Z'
---

# Describe How Multi-Head Attention Combines Many Attention Heads

Updates are combined for each token position. Different heads learn unique contextual relationships since each head has its own Q/K/V (attention maps). Heads run in parallel and each head proposes updates. In standard multi head attention, head outputs are concatenated then passed through a learned output projection.
