-- Триггер k_guard_profile_update (before update on k_profiles) объявлен security invoker
-- и вызывает функции схемы private. Права на эту схему были выданы только роли authenticated,
-- поэтому любой UPDATE public.k_profiles от имени service_role (например, из edge-функции
-- k-employee-admin при увольнении сотрудника) падал с "permission denied for schema private".
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
alter default privileges in schema private grant execute on functions to service_role;
