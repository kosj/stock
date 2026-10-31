BEGIN;
CREATE OR REPLACE FUNCTION public.list_mock_risk_accounts(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 3)
RETURNS TABLE(user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid_page_size'; END IF;
 RETURN QUERY SELECT a.user_id FROM mock_accounts a JOIN auth.users u ON u.id=a.user_id
 WHERE a.trading_mode='mock' AND u.raw_app_meta_data->>'role' IN ('admin','user')
 AND (p_after IS NULL OR a.user_id>p_after) ORDER BY a.user_id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.list_mock_risk_accounts(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_mock_risk_accounts(uuid,integer) TO service_role;
COMMIT;
