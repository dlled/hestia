CREATE TABLE energy_reading (
  reading_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  meter_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  power_w DOUBLE PRECISION NOT NULL,
  energy_kwh DOUBLE PRECISION NOT NULL
);

CREATE INDEX energy_reading_home_time_idx ON energy_reading (home_id, observed_at DESC);

CREATE TABLE energy_tariff (
  tariff_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  price_per_kwh DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL
);

CREATE INDEX energy_tariff_home_time_idx ON energy_tariff (home_id, starts_at);

CREATE TABLE energy_recommendation (
  recommendation_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL
);
