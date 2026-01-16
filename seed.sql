-- Seed feedback events
INSERT INTO feedback_events (text, timestamp, source, contract_value, is_actionable) VALUES
('The app crashes every time I try to export my data. This is blocking our entire team.', '2026-01-10T09:15:00Z', 'CS', 50000, NULL),
('Performance is terrible when loading dashboards with large datasets', '2026-01-10T14:22:00Z', 'GitHub', NULL, NULL),
('Pricing is too expensive for small teams. We need a starter tier.', '2026-01-11T10:05:00Z', 'X', NULL, NULL),
('Great product, thanks!', '2026-01-11T11:30:00Z', 'Email', NULL, NULL),
('The onboarding process is confusing. Took me 2 hours to set up.', '2026-01-11T16:45:00Z', 'Discord', NULL, NULL),
('Add ability to export data to CSV format', '2026-01-12T08:00:00Z', 'GitHub', NULL, NULL),
('App does not work on mobile Safari. Buttons are not clickable.', '2026-01-12T13:20:00Z', 'CS', 120000, NULL),
('Slow loading times when switching between pages', '2026-01-12T15:10:00Z', 'Email', NULL, NULL),
('Please add dark mode feature', '2026-01-13T09:30:00Z', 'X', NULL, NULL),
('The signup flow is broken. Cannot verify email.', '2026-01-13T11:00:00Z', 'CS', 80000, NULL),
('Love the new updates!', '2026-01-13T14:00:00Z', 'Discord', NULL, NULL),
('Expensive compared to competitors', '2026-01-14T08:15:00Z', 'Email', NULL, NULL),
('Bug: Data export fails with large files over 100MB', '2026-01-14T10:30:00Z', 'GitHub', NULL, NULL),
('Thanks for the quick support response', '2026-01-14T12:00:00Z', 'CS', 25000, NULL),
('Feature request: Add team collaboration tools', '2026-01-14T16:20:00Z', 'Discord', NULL, NULL);

-- Seed some aggregated themes (these would normally be created by AI)
INSERT INTO feedback_aggregated (aggregate_text) VALUES
('Export functionality issues'),
('Performance and speed problems'),
('Pricing concerns for small teams'),
('Onboarding and signup experience'),
('Mobile compatibility bugs'),
('Feature requests for collaboration');
