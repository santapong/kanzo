-- 7: native portfolio, task plans, explicit time and acceptance. No history backfill.
CREATE TABLE project_profiles (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    profile_json TEXT NOT NULL,
    acceptance_required INTEGER NOT NULL DEFAULT 0,
    semantic_revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE task_plans (
    task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
    plan_json TEXT NOT NULL DEFAULT '{}',
    acceptance_required INTEGER NOT NULL DEFAULT 0,
    semantic_revision INTEGER NOT NULL DEFAULT 1,
    CHECK(parent_id IS NULL OR parent_id <> task_id)
);
CREATE INDEX task_plans_parent ON task_plans(parent_id);
CREATE TABLE task_dependencies (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    prerequisite_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    PRIMARY KEY(task_id, prerequisite_id),
    CHECK(task_id <> prerequisite_id)
);
CREATE TABLE task_time_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('timer','manual')),
    started_at TEXT,
    ended_at TEXT,
    seconds INTEGER CHECK(seconds IS NULL OR seconds >= 0),
    note TEXT NOT NULL DEFAULT '',
    request_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(actor, request_id),
    CHECK(kind <> 'timer' OR started_at IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_timer_per_actor ON task_time_entries(actor) WHERE kind='timer' AND ended_at IS NULL;
CREATE INDEX task_time_by_task ON task_time_entries(task_id);
CREATE TABLE task_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    semantic_revision INTEGER NOT NULL,
    project_revision INTEGER NOT NULL,
    requirements_json TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    evidence TEXT NOT NULL,
    accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    valid INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX task_acceptance_current ON task_acceptances(task_id,valid);
CREATE TABLE task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX task_events_by_task ON task_events(task_id,id);
CREATE TRIGGER planning_task_created AFTER INSERT ON tasks BEGIN
 INSERT INTO task_events(task_id,kind,to_status) VALUES(new.id,'created',new.status);
END;
CREATE TRIGGER planning_task_status AFTER UPDATE OF status ON tasks WHEN old.status <> new.status BEGIN
 INSERT INTO task_events(task_id,kind,from_status,to_status) VALUES(new.id,'status',old.status,new.status);
END;
CREATE TRIGGER project_profiles_insert AFTER INSERT ON project_profiles BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER project_profiles_update AFTER UPDATE ON project_profiles BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER project_profiles_delete AFTER DELETE ON project_profiles BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_plans_insert AFTER INSERT ON task_plans BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_plans_update AFTER UPDATE ON task_plans BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_plans_delete AFTER DELETE ON task_plans BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_dependencies_insert AFTER INSERT ON task_dependencies BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_dependencies_delete AFTER DELETE ON task_dependencies BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER time_entries_insert AFTER INSERT ON task_time_entries BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER time_entries_update AFTER UPDATE ON task_time_entries BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER time_entries_delete AFTER DELETE ON task_time_entries BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_acceptances_insert AFTER INSERT ON task_acceptances BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_acceptances_update AFTER UPDATE ON task_acceptances BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;
CREATE TRIGGER task_events_insert AFTER INSERT ON task_events BEGIN UPDATE meta SET value=value+1 WHERE key='changes'; END;

-- Block already-open stock writers. Missing function fails closed; reads stay valid.
CREATE TRIGGER harness_writer_tasks_insert BEFORE INSERT ON tasks BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_tasks_update BEFORE UPDATE ON tasks BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_tasks_delete BEFORE DELETE ON tasks BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_comments_insert BEFORE INSERT ON comments BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_comments_update BEFORE UPDATE ON comments BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_comments_delete BEFORE DELETE ON comments BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_projects_insert BEFORE INSERT ON projects BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_projects_update BEFORE UPDATE ON projects BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_projects_delete BEFORE DELETE ON projects BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_repos_insert BEFORE INSERT ON project_repos BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_repos_update BEFORE UPDATE ON project_repos BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_repos_delete BEFORE DELETE ON project_repos BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_images_insert BEFORE INSERT ON images BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_images_update BEFORE UPDATE ON images BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_images_delete BEFORE DELETE ON images BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_profiles_insert BEFORE INSERT ON project_profiles BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_profiles_update BEFORE UPDATE ON project_profiles BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_project_profiles_delete BEFORE DELETE ON project_profiles BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_plans_insert BEFORE INSERT ON task_plans BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_plans_update BEFORE UPDATE ON task_plans BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_plans_delete BEFORE DELETE ON task_plans BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_dependencies_insert BEFORE INSERT ON task_dependencies BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_dependencies_update BEFORE UPDATE ON task_dependencies BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_dependencies_delete BEFORE DELETE ON task_dependencies BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_time_entries_insert BEFORE INSERT ON task_time_entries BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_time_entries_update BEFORE UPDATE ON task_time_entries BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_time_entries_delete BEFORE DELETE ON task_time_entries BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_acceptances_insert BEFORE INSERT ON task_acceptances BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_acceptances_update BEFORE UPDATE ON task_acceptances BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_acceptances_delete BEFORE DELETE ON task_acceptances BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_events_insert BEFORE INSERT ON task_events BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_events_update BEFORE UPDATE ON task_events BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
CREATE TRIGGER harness_writer_task_events_delete BEFORE DELETE ON task_events BEGIN
 SELECT CASE WHEN kanzo_harness_writer() <> 7 THEN RAISE(ABORT,'upgrade Kanzo writer') END;
END;
