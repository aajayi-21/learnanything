---
schema_version: 1
id: note_lo_multi_head_attention_purpose_20260530203332
subjects:
  - attn
related_los:
  - lo_multi_head_attention_purpose
related_concepts: []
source_type: learner_note
created_at: '2026-05-30T20:33:42Z'
updated_at: '2026-05-30T20:33:42Z'
---

# Explain why the Transformer uses multi-head attention

Single full dimensional head can inhibit distinct attention patterns from averaging it. Since per head you have less dimensions, multi head has equivalent performance with augmented representational value compared to a single head alone. Different heads can attend to different positions which means different patterns.
