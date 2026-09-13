-- Reviewed 2026-09-12 against the exact stable model's standard TEXT tariffs.
-- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
-- https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite
-- Google documents restricted new-user access to the old 2.5 models:
-- https://discuss.ai.google.dev/t/auth-key-can-list-models-but-generatecontent-returns-http-404-not-found-for-gemini-2-5-flash/180197/2
-- Deploy the exact-model Gemini 3 thinkingLevel adapter before applying this.
-- Preserve opt-in, all caps/budgets, TTL, tier, weight, reasoning allowance and rate expiry.
-- Cover only the four reviewed slots. This does not enable any feature, including drafting,
-- or migrate any unreviewed/configured alternative model. Compatibility is not a quality claim.
-- Existing reservations retain their frozen model/rates; cache revisions change only once.
begin;
select id from public.ai_company_budget where id=true for update;
update public.ai_config
set model='gemini-3.1-flash-lite',input_usd_per_million=0.25,
 cached_input_usd_per_million=0.025,output_usd_per_million=1.50,revision=revision+1
where provider='gemini'
 and ((feature in ('classify_ask','search_keywords') and model='gemini-2.5-flash' and reasoning_token_allowance=0)
   or (feature='ask_mighty' and model='gemini-2.5-flash')
   or (feature='profile_briefing' and model='gemini-2.5-pro'))
 and input_usd_per_million>=0.25 and cached_input_usd_per_million>=0.025 and output_usd_per_million>=1.50;
commit;
