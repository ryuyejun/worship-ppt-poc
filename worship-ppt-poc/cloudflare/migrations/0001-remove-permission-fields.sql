DROP TABLE IF EXISTS public_lyrics_authorizations;
ALTER TABLE songs DROP COLUMN copyright_info;
ALTER TABLE songs DROP COLUMN permission_status;
ALTER TABLE songs DROP COLUMN permission_evidence;
