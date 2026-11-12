# Search by meaning (embeddings): design

Status: phases 1 to 3 built (November 2026). Related: PLAN §6 (multilingual), §8.1,
§9, §11, §13. How to run it: README, "Search by meaning".

## 1. Goal and constraints

Search by meaning finds "Do you fix leaky taps?" in a page that says "faucet repair", and an English
page from a French question, where keyword search (full text + trigram) can't. It must be:

- **Cheap:** a small business's whole knowledge base costs a fraction of a cent to embed, and
  unchanged text is never embedded twice.
- **Fast:** adds nothing measurable to the time to first text (now a median of 2.7 s, target 1.5 s).
- **Never in the way:** keyword search keeps working when the embedding service is slow, down or
  not configured. An embedding problem never turns an answer into an error.

## 2. What exists today, and what's wrong with it

Built: `EmbeddingProvider` (OpenAI-compatible endpoint, Voyage `input_type`), `chunks.embedding`
(`vector`, no fixed size) and `chunks.embedding_model`, and a vector arm in `retrievePassages`
merged with reciprocal-rank fusion. Embeddings are off in development (`EMBEDDINGS_*` unset).

| # | Problem | Where | Effect |
|---|---|---|---|
| 1 | The question is embedded **before** retrieval, one step after another, with no timeout | `engine.ts` §3, `search-knowledge.ts` | Adds a full network round trip to every answer |
| 2 | A failed embedding call throws | same | The visitor gets the error message instead of a keyword-based answer |
| 3 | Documents are embedded **inside the database transaction** of the source sync | `index-documents.ts` | A slow provider holds a transaction open; an outage fails the whole sync |
| 4 | A changed page re-embeds every chunk, even chunks whose text didn't change | same | Pays again for unchanged text on every crawl |
| 5 | Changing the model leaves the old vectors; nothing re-embeds them | — | Search by meaning silently stops until every source is synced again |
| 6 | The nearest 20 chunks always count, however far | `retrieval.ts` | Unrelated text gets a ranking boost, which works against "say you don't know" |
| 7 | Only chunks are embedded; Q&A pairs, services and photos aren't | — | "How much for a tune-up" doesn't find the owner's Q&A worded differently |
| 8 | Embedding use isn't metered | — | Cost per business is invisible in the operator console |
| 9 | Vectors are stored as 32-bit floats at the model's full size | schema | 4–6 KB per chunk, 4–6× what's needed |

Phase 1 fixed all of these except 7, which phase 2 fixed for Q&A pairs and photos. Services aren't
embedded: the whole list is in every prompt already, so there is nothing to search.

## 3. Cost: what actually matters

Two of the main hosted options, Voyage `voyage-4-lite` and OpenAI `text-embedding-3-small`, both
list at **$0.02 per million tokens** (Voyage includes 200 million free tokens).

| Volume | Tokens | Cost at $0.02 / M |
|---|---|---|
| One business, whole knowledge base (≈500 chunks × 400 tokens) | 200 k | $0.004 |
| 1,000 businesses, everything embedded again every week | ≈ 800 M / month | ≈ $16 / month |
| 1,000 businesses × 1,000 questions / month × 30 tokens | 30 M / month | $0.60 / month |

Money spent on embedding calls is negligible. What costs something is **storage and memory** (the
vectors sit beside the text in Postgres) and **latency** on the chat path. The design spends its
effort there.

## 4. Architecture

```
 INDEXING (worker, off the request path)
 ───────────────────────────────────────
 source sync ──▶ indexDocuments (one transaction, no network)
                   • chunks written with tsvector, embedding = null
                   • unchanged chunk text (same hash) keeps its vector
                   └─▶ enqueue job "embed.chunks" { botId }
 embed.chunks ──▶ select chunks of the bot where vector missing or model ≠ current
                  ──▶ provider.embed(batch of 128, "document")   ← retried with backoff, no transaction open
                  ──▶ update chunks set embedding, embedding_model   (withTenant)
                  ──▶ record usage (kind "embedding", tokens)
 The same job then embeds Q&A pairs and photo descriptions whose text or model changed, and moves
 everything to a new model (backfill).

 ANSWERING (API, per question)
 ─────────────────────────────
 message arrives ─┬─▶ query writer / triage (aux model)       ┐
                  ├─▶ embed(message [+ previous question])    │ all started at once
                  │      cache: process LRU → Redis → provider │
                  └─▶ bot, profile, history reads             ┘
 queries ready ──▶ wait for the vector at most 150 ms more ── late or failed → keyword only
               ──▶ retrievePassages: full text + trigram + vector (distance floor) → RRF
```

### 4.1 Provider layer (`packages/llm`)

- **Model profile:** `{ provider, model, dims, queryPrefix, documentPrefix, maxInputTokens }`.
  The stored `embedding_model` is `provider/model@dims` (e.g. `voyage/voyage-4-lite@512`), so a
  change of size counts as a change of model.
- **Shorter vectors:** models trained for it (Voyage 4, OpenAI 3, most recent open models) keep most
  of their quality when the vector is cut to 512 numbers (Matryoshka). Ask the provider for 512 when it
  supports `dimensions`/`output_dimension`, otherwise cut and re-normalize ourselves.
- **Timeouts and failures:** queries get a hard deadline (see 4.3) and no retries; documents get
  3 retries with backoff. A circuit breaker skips the provider for 30 s after 5 failures in a row, so
  an outage doesn't add a timeout to every question.
- **Two backends, one interface:**
  - *Hosted* (default): OpenAI-compatible `/embeddings` (Voyage, OpenAI, OpenRouter, Azure, …).
    Best quality for the money, no servers to run.
  - *Local* (`EMBEDDINGS_PROVIDER=local`): a small multilingual ONNX model run in-process
    (transformers.js on `onnxruntime-node`, an optional dependency),
    e.g. `multilingual-e5-small` (384 numbers) or a newer small model that does better in our evals.
    No cost per call, about 3 ms per question on a CPU (§7), and visitor questions
    never leave our servers: the path for Canadian data residency (clinics, PLAN §12, Phase 3).
    Costs 0.6–1 GB of memory per process (§7) and some quality; documents must use the same
    model, so the worker runs it too.

### 4.2 Indexing (`packages/core/src/knowledge`, worker)

- `indexDocuments` makes **no network calls**. It writes chunks with `embedding = null`, so keyword
  search works the moment a source is read, and the sync can't fail because of the embedding service.
- **Reuse instead of re-embedding:** a new column `chunks.content_hash` (sha256 of heading + text).
  Before a changed document's old chunks are deleted, vectors are copied to new chunks with the same
  hash and model. Re-crawling a site where one paragraph changed embeds one chunk, not the page.
  The reuse stays inside the business (no cross-tenant cache: it would save little and blur tenant
  isolation).
- **Job `embed.chunks { botId }`**, de-duplicated per bot while one is waiting. It picks up rows whose
  vector is missing **or made by another model**, so the same job fills new chunks, retries after an
  outage, and moves everything to a new model (`pnpm embeddings:backfill` enqueues it for every bot).
  While a backfill runs, rows not yet moved are found by keyword search only.
- **Q&A pairs and photos** (`qa_pairs`, `knowledge_images`) carry `embedding`, `embedding_model` and
  `embedding_hash` (md5 of the text the vector was made from: question + answer, or title +
  description). They are edited in place, so the job treats a row as stale when the hash or the model
  no longer matches; no write path has to remember to clear a vector. Saving one (Q&A, an answered
  gap, an applied setup suggestion, a demo build, a photo's text) queues the job when embeddings are on.
- Batches of 128 texts; the Batch API price (‑33 % to ‑50 %) is worth it only for a full backfill.

### 4.3 Answering (`packages/core/src/chat`)

- **Started first, awaited last.** The question's vector is requested the moment the message arrives,
  alongside the query writer and the database reads. A multilingual model matches a French question to
  English text without waiting for the translated queries. For a follow-up, the previous question is
  embedded with it ("How much is it?" + "Do you replace water heaters?"), which gives the context
  without waiting for the rewrite.
- **Deadline:** when the keyword queries are ready, retrieval waits for the vector at most
  **250 ms** more (`EMBEDDINGS_QUERY_WAIT_MS`), then goes ahead without it and logs `embedding late`.
  On the fast path (no rewrite needed), retrieval never waits more than that; 150 ms dropped a third of
  first-time vectors (§7).
- **Cache:** an in-process LRU (5,000 vectors) in front of Redis (30 days), keyed by
  `model + sha256(normalized text)`. Suggested questions (quick replies) are embedded when the owner
  saves them, so a tap on one never waits. The `search_knowledge` tool uses the same cache,
  with a longer wait (800 ms), as the model is waiting for the tool anyway.
- **Failure:** never thrown. The answer goes ahead on keyword search.

### 4.4 Storage and search (`packages/db`)

- `embedding` becomes **`halfvec`** (16-bit floats): half the size, with a negligible difference in
  ranking. At 512 numbers that is **1 KB per chunk instead of 4–6 KB**. The column keeps no fixed
  size, so two models can coexist during a move.
- **No approximate index yet.** Every search is already narrowed to one assistant (`chunks_bot_idx`),
  usually a few hundred to a few thousand chunks. Comparing all of them is exact (nothing missed),
  needs no tuning and no index memory, and takes a few milliseconds.
- **Distance floor:** vector results count only when closer than a per-model cutoff
  (`EMBEDDINGS_MAX_DISTANCE`, set from evals; 0.85 by default, 0.75 for voyage-4-lite), so an
  off-topic question doesn't pull in the 20 least-bad chunks. It can't tell a related question the
  text doesn't answer from one it does (§7); deciding "I don't know" stays the chat model's job.
- **Q&A pairs and photos by meaning:** short texts, so a real match is much closer than a chunk needs
  to be. They count by meaning only within **0.75 × the model's cutoff** (0.56 for voyage-4-lite; §7).
  A Q&A pair matched by its words still ranks first; one matched only by meaning ranks like a chunk
  found twice by vector, so a loosely related pair can't push the right text out. The keyword match
  for Q&A pairs now ignores filler words ("do", "you", "vous", "les"): before, any pair sharing one
  with the question was ranked first.
- **When to add an index** (PLAN §13): when one assistant passes ~20,000 chunks or a search takes more
  than 20 ms. Then add a partial HNSW index for the current model on `(embedding::halfvec(512))`, with
  pgvector 0.8 iterative scans so the assistant filter doesn't empty the results (0.8.7 is installed).

### 4.5 Measuring it (`packages/evals`)

- Retrieval metrics per case: did the expected passage come in the top 5 (recall@5) and at what rank,
  for EN, FR and cross-language questions, with and without embeddings.
- Latency: share of questions where the vector was late, and time spent waiting for it.
- Run the candidate models (two hosted, one or two local) through it before choosing, and to set each
  model's distance floor.
- Usage: embedding tokens per business in `usage_events` (kind `embedding`), shown with AI cost in the
  operator console.

## 5. Recommendation

1. **Hosted small multilingual model at 512 numbers** (`voyage-4-lite`, or `text-embedding-3-small`;
   decided by the evals). Cost is negligible either way; quality is the best per dollar; nothing to run.
2. **Latency is solved by the pipeline, not the model:** started in parallel, cached, 250 ms deadline
   (150 ms in the first draft; §7 measured it), keyword fallback.
3. **Local ONNX model as the second backend** when data residency is needed (Phase 3), chosen with the
   same evals.

## 6. Phases

| Phase | Work | Size |
|---|---|---|
| **1. Fast and safe** (built) | Model profile and 512-number vectors; `halfvec` migration; `indexDocuments` without network calls + `content_hash` reuse; `embed.chunks` job with backfill; query vector in parallel with deadline, cache and fallback; distance floor; usage metering; retrieval metrics in evals | 2–3 days |
| **2. Embed everything** (built) | Q&A pairs and photos (services are in every prompt already); quick replies embedded on save | 1 day |
| **3. Local backend** (built) | ONNX provider, model download and warm-up, memory limits, evals against the hosted model | 1–2 days |
| Later | HNSW index when the thresholds in 4.4 are reached | — |

## 7. Measurements (November 2026)

`pnpm evals:retrieval`: 27 questions (15 EN, 12 FR) worded differently from the two test businesses'
text, plus 10 that nothing answers. The question as typed, no query rewriting. Models through
OpenRouter from a laptop in Ontario; latency is the first request (no cache).

| Model (vector size) | Price / M tokens | Right text first (EN / FR / all) | MRR | Question vector median / p95 |
|---|---|---|---|---|
| Keyword search alone | — | 53 % / 8 % / 33 % | 0.49 | — |
| **voyage-4-lite (512)** | $0.02 | 87 % / 75 % / 81 % | 0.90 | **140 / 239 ms** |
| text-embedding-3-small (512) | $0.02 | 80 % / 75 % / 78 % | 0.88 | 262 / 401 ms |
| qwen3-embedding-4b (512) | $0.02 | 87 % / 83 % / 85 % | 0.92 | 163 / 1,154 ms |
| bge-m3 (1024) | $0.01 | 87 % / 83 % / 85 % | 0.90 | 308 / 770 ms |
| multilingual-e5-large (1024) | $0.01 | 80 % / 75 % / 78 % | 0.85 | 1,006 / 1,215 ms |

- **Quality** differs by one or two questions out of 27 between the four best: within noise for a set
  this size. Every model lifts French questions on English text from 8 % to 75–83 %.
- **Speed decides:** only voyage-4-lite usually comes back within the wait (median 140 ms). At a
  150 ms wait a third of its vectors came too late; at 250 ms about 95 % arrive in time.
- **Distances (voyage-4-lite):** the answering text sits at 0.39–0.70; related questions nothing
  answers (solar panels, chimney sweeping, used cars) come as close as 0.51, so no cutoff separates
  them; off-topic questions (pizza, yoga, snow removal) are at 0.76–0.83. A cutoff of 0.75 keeps every
  answer and drops the off-topic.
- **Chosen:** voyage-4-lite at 512, wait 250 ms, cutoff 0.75. In development it runs through OpenRouter
  with the chat key; direct from Voyage it should be faster still (not measured: no key).
- Stored size: about 1 KB per vector (measured on 25 chunks of the eval businesses).
- **End to end** (`pnpm evals`, DeepSeek V4.1 Flash for answers, embeddings on): 59 of 59 cases pass
  after one scorer fix ("Get everyone out of the house" now counts as telling the visitor to leave);
  median time to first text 1.8 s (2.7 s in the earlier run without embeddings, on another day, so
  not a controlled comparison, but the vector clearly doesn't slow answers down).

### Phase 2: the owner's Q&A pairs (voyage-4-lite)

Each test business gets one Q&A pair on something its text doesn't mention (shoe covers; dogs in the
waiting room), asked in other words in English and French.

- **Found:** keyword search 1 of 4, with vectors 4 of 4, each ranked first.
- **Distances** between a question and a Q&A pair: real matches 0.32–0.54; other questions about the
  same business 0.57–0.75; unrelated above 0.8. Hence the tighter cutoff (0.75 × 0.75 = 0.56). The gap
  is narrow and the sample small: revisit when real Q&A data exists.
- **Cost of a wrong match:** of the 37 other questions, 2 brought up a Q&A pair that doesn't answer
  them; it takes one of the six places and the right text stays in the list ("right text first" for
  the 27 answerable questions: 78 %, one question lower than without the pairs).
- **Found on the way:** the old keyword match put a Q&A pair first for any question sharing a filler
  word with it ("you", "your", "vous"). With one pair per business that dropped "right text first"
  from 33 % to 11 % for keyword search; ignoring filler words restored it.
- Photos use the same rule; covered by tests, not by this benchmark (the test businesses have none).
- The same filler-word fix applies to photos (a photo sharing "the" with the question was offered).
  For chunks it was tried and left out: keyword "right text first" rose from 33 % to 41 %, but four
  questions lost their text altogether and the result with vectors fell from 78 % to 74 %. Chunks are
  sorted by rank, which already puts filler-only matches last.

### Phase 3: a model run locally (multilingual-e5-small, 8-bit, 384 numbers)

Same benchmark, on an Apple M2 Pro laptop (a server CPU will differ):

| | voyage-4-lite (hosted) | multilingual-e5-small (local) |
|---|---|---|
| Right text first (EN / FR / all) | 87 % / 67 % / 78 % | 73 % / 75 % / 74 % |
| MRR | 0.88 | 0.85 |
| Owner's answers found | 4 of 4 | 4 of 4 |
| Question vector, median / p95 | 133 / 186 ms | **3 / 3 ms** |
| Cost per million tokens | $0.02 | none |

- **Quality:** one question behind the hosted model out of 27: within noise. French questions on
  English text work as well.
- **Speed:** 3 ms per question, so the 250 ms wait is never used up. 128 chunks of about 900
  characters take 1.5 s.
- **Memory:** about 0.6 GB after loading and up to 1 GB while embedding documents, in **each**
  process (API and worker): more than the 200–500 MB first assumed. Loading takes 0.5 s once the
  model (130 MB) is on disk; the API loads it at start.
- **Distances are squeezed together** with this model: answering text 0.12–0.23, questions nothing
  answers from 0.18, off-topic 0.23. The cutoff (0.23) keeps every answer but filters almost nothing,
  so it leans even more on the chat model to say "I don't know". Q&A pairs at 0.75 × 0.23: 4 of 4
  found, none brought up wrongly.
- **When to use it:** data residency, or no embedding provider. Otherwise the hosted model stays the
  default: no memory to hold, a cutoff that does filter off-topic questions.
- Not measured: other local models, a Linux server CPU, and the chat evals end to end with the local
  model.
