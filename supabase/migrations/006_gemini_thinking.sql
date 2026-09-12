begin;
-- These short Flash tasks request 128 output tokens. Gemini counts thinking
-- within that limit, so a 1024-token thinking budget can consume the answer.
-- Change only the verified Flash model and invalidate cache entries by revision.
-- Do not enable features, change rates, or alter existing call reservations.
update public.ai_config
set reasoning_token_allowance=0,revision=revision+1
where feature in ('classify_ask','search_keywords')
  and provider='gemini' and model='gemini-2.5-flash'
  and reasoning_token_allowance<>0;
commit;
