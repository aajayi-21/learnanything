---
schema_version: 1
id: note_lo_qk_attention_pattern_20260615014130
subjects:
  - attn
related_los:
  - lo_qk_attention_pattern
related_concepts: []
source_type: learner_note
created_at: '2026-06-15T01:41:31Z'
updated_at: '2026-06-15T01:41:31Z'
---

# Compute Attention Weights From Queries And Keys

first, we compute query and key vectors. then we compute pairwise dot products after Q/K projection. Then, we scale by sqrt of key-query dimension. After that we apply column-wise softmax to normalize everything to 1
