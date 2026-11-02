-- Historical feedback is retained independently of removable portfolio objects.
CREATE TABLE feedback_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_slug TEXT NOT NULL,
 project_id_at_report INTEGER NOT NULL,
 task_id INTEGER,
 reporter TEXT NOT NULL,
 request_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 severity TEXT NOT NULL,
 summary TEXT NOT NULL,
 observed TEXT NOT NULL,
 body_json TEXT NOT NULL CHECK(length(CAST(body_json AS BLOB)) <= 16384),
 app_version TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 UNIQUE(project_slug,reporter,request_id)
);
CREATE INDEX feedback_reports_project ON feedback_reports(project_slug,id);
CREATE INDEX feedback_reports_identity ON feedback_reports(project_id_at_report,id);
CREATE TABLE feedback_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 feedback_id INTEGER NOT NULL REFERENCES feedback_reports(id),
 revision INTEGER NOT NULL,
 decision TEXT NOT NULL,
 applies_to_version TEXT NOT NULL,
 review_json TEXT NOT NULL CHECK(length(CAST(review_json AS BLOB)) <= 16384),
 reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
 UNIQUE(feedback_id,revision)
);
CREATE TRIGGER feedback_reports_writer BEFORE INSERT ON feedback_reports BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM feedback_reports WHERE id=new.id OR (project_slug=new.project_slug AND reporter=new.reporter AND request_id=new.request_id)) THEN RAISE(ABORT,'feedback reports are immutable') END;
END;
CREATE TRIGGER feedback_reviews_writer BEFORE INSERT ON feedback_reviews BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM feedback_reviews WHERE id=new.id OR (feedback_id=new.feedback_id AND revision=new.revision)) THEN RAISE(ABORT,'feedback review history is immutable') END;
END;
CREATE TRIGGER feedback_reports_immutable_update BEFORE UPDATE ON feedback_reports BEGIN
 SELECT RAISE(ABORT,'feedback reports are immutable');
END;
CREATE TRIGGER feedback_reports_immutable_delete BEFORE DELETE ON feedback_reports BEGIN
 SELECT RAISE(ABORT,'feedback reports are immutable');
END;
CREATE TRIGGER feedback_reviews_immutable_update BEFORE UPDATE ON feedback_reviews BEGIN
 SELECT RAISE(ABORT,'feedback review history is immutable');
END;
CREATE TRIGGER feedback_reviews_immutable_delete BEFORE DELETE ON feedback_reviews BEGIN
 SELECT RAISE(ABORT,'feedback review history is immutable');
END;
CREATE TRIGGER feedback_reports_insert AFTER INSERT ON feedback_reports BEGIN
 UPDATE meta SET value=value+1 WHERE key='changes';
END;
CREATE TRIGGER feedback_reviews_insert AFTER INSERT ON feedback_reviews BEGIN
 UPDATE meta SET value=value+1 WHERE key='changes';
END;
