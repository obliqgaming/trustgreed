CREATE OR REPLACE FUNCTION public.bootstrap_first_profile(p_username text)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_existing_count bigint;
  v_profile profiles;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;

  select count(*) into v_existing_count from profiles;

  if v_existing_count > 0 then
    raise exception 'Le registre n''est plus vierge : un code d''invitation est requis.';
  end if;

  insert into profiles (id, username, invited_by_profile_id)
    values (auth.uid(), p_username, null)
    returning * into v_profile;

  return v_profile;
end;
$$;