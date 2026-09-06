ALTER TABLE model_calls ADD COLUMN provider_model TEXT;
ALTER TABLE model_calls ADD COLUMN input_tokens INTEGER;
ALTER TABLE model_calls ADD COLUMN output_tokens INTEGER;
