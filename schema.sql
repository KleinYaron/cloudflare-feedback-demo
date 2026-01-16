-- Drop existing tables if they exist
DROP TABLE IF EXISTS feedback_match;
DROP TABLE IF EXISTS feedback_aggregated;
DROP TABLE IF EXISTS feedback_events;

-- Table 1: Raw feedback events
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('CS', 'GitHub', 'X', 'Discord', 'Email')),
  contract_value REAL,
  is_actionable INTEGER CHECK(is_actionable IN (0, 1))
);

-- Table 2: Aggregated themes
CREATE TABLE feedback_aggregated (
  aggregate_id INTEGER PRIMARY KEY AUTOINCREMENT,
  aggregate_text TEXT NOT NULL UNIQUE
);

-- Table 3: Many-to-many mapping
CREATE TABLE feedback_match (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aggregate_id INTEGER,
  feedback_id INTEGER,
  FOREIGN KEY (aggregate_id) REFERENCES feedback_aggregated(aggregate_id),
  FOREIGN KEY (feedback_id) REFERENCES feedback_events(id)
);

-- Create indexes for better query performance
CREATE INDEX idx_feedback_timestamp ON feedback_events(timestamp);
CREATE INDEX idx_feedback_source ON feedback_events(source);
CREATE INDEX idx_match_aggregate ON feedback_match(aggregate_id);
CREATE INDEX idx_match_feedback ON feedback_match(feedback_id);
