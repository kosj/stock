-- Atomic full portfolio import. Never delete existing rows in a separate request.
BEGIN;
CREATE OR REPLACE FUNCTION replace_portfolio_positions(
 p_user_id UUID, p_portfolio_id BIGINT, p_positions JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item JSONB; key TEXT; symbol TEXT; seen TEXT[]:=ARRAY[]::TEXT[]; result JSONB;
BEGIN
 -- Serialize replacements for this portfolio and check ownership in the same lock.
 PERFORM 1 FROM portfolios WHERE id=p_portfolio_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'permission_denied'; END IF;
 IF p_positions IS NULL OR jsonb_typeof(p_positions)<>'array' THEN RAISE EXCEPTION 'invalid_positions'; END IF;
 IF jsonb_array_length(p_positions)>200 OR octet_length(p_positions::TEXT)>65536 THEN RAISE EXCEPTION 'positions_limit_exceeded'; END IF;
 -- Validate the entire payload before any DELETE. Type checks prevent JSON strings,
 -- booleans, nulls or fractional quantities from being coerced to plausible values.
 FOR item IN SELECT value FROM jsonb_array_elements(p_positions) LOOP
  IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'invalid_position'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN
    ('ticker','name','quantity','avg_price','stop_loss','take_profit','strategy','notes'))
   THEN RAISE EXCEPTION 'unknown_position_field'; END IF;
  IF jsonb_typeof(item->'ticker') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number'
   OR jsonb_typeof(item->'avg_price') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_position'; END IF;
  symbol:=upper(btrim(item->>'ticker'));
  IF symbol !~ '^[A-Z0-9^][A-Z0-9.^-]{0,19}$' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100
   OR (item->>'quantity')::NUMERIC<>trunc((item->>'quantity')::NUMERIC)
   OR NOT((item->>'quantity')::NUMERIC BETWEEN 1 AND 2147483647)
   OR NOT((item->>'avg_price')::FLOAT>0 AND (item->>'avg_price')::FLOAT<'Infinity'::FLOAT)
   THEN RAISE EXCEPTION 'invalid_position'; END IF;
  IF symbol=ANY(seen) THEN RAISE EXCEPTION 'duplicate_ticker'; END IF;
  seen:=array_append(seen,symbol);
  FOREACH key IN ARRAY ARRAY['stop_loss','take_profit'] LOOP
   IF item ? key AND item->key<>'null'::JSONB THEN
    IF jsonb_typeof(item->key)<>'number' THEN RAISE EXCEPTION 'invalid_position_price'; END IF;
    IF NOT((item->>key)::FLOAT>0 AND (item->>key)::FLOAT<'Infinity'::FLOAT) THEN RAISE EXCEPTION 'invalid_position_price'; END IF;
   END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['strategy','notes'] LOOP
   IF item ? key AND item->key<>'null'::JSONB THEN
    IF jsonb_typeof(item->key)<>'string' OR length(item->>key)>(CASE WHEN key='strategy' THEN 2000 ELSE 10000 END)
     THEN RAISE EXCEPTION 'invalid_position_text'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 DELETE FROM positions WHERE portfolio_id=p_portfolio_id;
 WITH inserted AS (
  INSERT INTO positions(portfolio_id,ticker,name,quantity,avg_price,stop_loss,take_profit,strategy,notes)
  SELECT p_portfolio_id,upper(btrim(value->>'ticker')),btrim(value->>'name'),
   (value->>'quantity')::NUMERIC::INTEGER,(value->>'avg_price')::FLOAT,
   (value->>'stop_loss')::FLOAT,(value->>'take_profit')::FLOAT,value->>'strategy',value->>'notes'
  FROM jsonb_array_elements(p_positions)
  RETURNING id,portfolio_id,ticker,name,quantity,avg_price,stop_loss,take_profit,strategy,notes,created_at,updated_at
 ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted) ORDER BY id),'[]'::JSONB) INTO result FROM inserted;
 UPDATE portfolios SET updated_at=clock_timestamp() WHERE id=p_portfolio_id;
 RETURN jsonb_build_object('positions',result);
END; $$;
REVOKE ALL ON FUNCTION replace_portfolio_positions(UUID,BIGINT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION replace_portfolio_positions(UUID,BIGINT,JSONB) TO service_role;
COMMIT;
