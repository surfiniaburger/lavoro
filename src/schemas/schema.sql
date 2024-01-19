CREATE TABLE IF NOT EXISTS query_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX idx_query_results_query ON query_results (query);

INSERT INTO query_results (query, result) VALUES ('example query', 'example result');
