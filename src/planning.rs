//! Native planning data. Context is selected references, never arbitrary filesystem reads.
use crate::store::{Error, Result, Store, Task};
use rusqlite::{Connection, OptionalExtension, params};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ProjectProfile {
    pub category: String,
    pub visibility: String,
    pub goal: String,
    pub source_path: String,
    pub source_revision: String,
    pub allowed_scope: String,
    pub acceptance: String,
    pub budget: String,
    pub instructions: Vec<String>,
    pub skills: Vec<String>,
    pub memories: Vec<String>,
    pub context_notes: String,
}
impl Default for ProjectProfile {
    fn default() -> Self {
        Self {
            category: "Needs classification".into(),
            visibility: "review".into(),
            goal: String::new(),
            source_path: String::new(),
            source_revision: String::new(),
            allowed_scope: String::new(),
            acceptance: String::new(),
            budget: String::new(),
            instructions: vec![],
            skills: vec![],
            memories: vec![],
            context_notes: String::new(),
        }
    }
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, JsonSchema)]
#[serde(default)]
pub struct ContextRef {
    pub kind: String,
    pub label: String,
    pub path: String,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TaskPlan {
    pub parent_id: Option<i64>,
    pub depends_on: Vec<i64>,
    pub planned_start: Option<String>,
    pub planned_end: Option<String>,
    pub due_date: Option<String>,
    pub estimate_seconds: Option<i64>,
    pub owner: String,
    pub deliverable: String,
    pub acceptance: String,
    pub allowed_scope: String,
    pub budget: String,
    pub context_links: Vec<ContextRef>,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}
fn encode<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| invalid(e.to_string()))
}
fn decode<T: for<'de> Deserialize<'de>>(value: &str) -> Result<T> {
    serde_json::from_str(value).map_err(|e| invalid(format!("invalid stored planning data: {e}")))
}
fn token(value: &str, name: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(invalid(format!("{name} must be 1–256 characters without controls")));
    }
    Ok(value.to_string())
}
fn date(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || b.iter().enumerate().any(|(i, c)| i != 4 && i != 7 && !c.is_ascii_digit())
    {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (value[..4].parse::<u32>(), value[5..7].parse::<usize>(), value[8..].parse::<u32>())
    else {
        return false;
    };
    let days = [
        31,
        if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    y > 0 && (1..=12).contains(&m) && d > 0 && d <= days[m.saturating_sub(1).min(11)]
}
fn event(c: &Connection, id: i64, kind: &str, details: Value) -> Result<()> {
    c.execute("INSERT INTO task_events(task_id,kind,details) VALUES(?1,?2,?3)", params![id, kind, encode(&details)?])?;
    Ok(())
}
fn revision(c: &Connection, id: i64) -> Result<i64> {
    Ok(c.query_row("SELECT semantic_revision FROM task_plans WHERE task_id=?1", [id], |r| r.get(0))
        .optional()?
        .unwrap_or(1))
}
fn project_revision(c: &Connection, id: i64) -> Result<i64> {
    Ok(c.query_row("SELECT pp.semantic_revision FROM tasks t LEFT JOIN project_profiles pp ON pp.project_id=t.project_id WHERE t.id=?1",[id],|r|r.get::<_,Option<i64>>(0))?.unwrap_or(1))
}
fn requirements(c: &Connection, id: i64) -> Result<Vec<i64>> {
    let mut q=c.prepare("SELECT task_id FROM task_plans WHERE parent_id=?1 UNION SELECT prerequisite_id FROM task_dependencies WHERE task_id=?1 ORDER BY 1")?;
    Ok(q.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?)
}
fn children(c: &Connection, id: i64) -> Result<Vec<i64>> {
    let mut q = c.prepare("SELECT task_id FROM task_plans WHERE parent_id=?1 ORDER BY task_id")?;
    Ok(q.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?)
}
fn graph_valid(c: &Connection) -> Result<()> {
    let cycle: bool=c.query_row("WITH RECURSIVE edges(a,b) AS (SELECT parent_id,task_id FROM task_plans WHERE parent_id IS NOT NULL UNION SELECT task_id,prerequisite_id FROM task_dependencies), reach(a,b) AS (SELECT a,b FROM edges UNION SELECT reach.a,edges.b FROM reach JOIN edges ON reach.b=edges.a) SELECT EXISTS(SELECT 1 FROM reach WHERE a=b)",[],|r|r.get(0))?;
    if cycle { Err(invalid("required children and dependencies form a readiness cycle")) } else { Ok(()) }
}

impl Store {
    pub fn project_profile(&self, slug: &str) -> Result<ProjectProfile> {
        let project = self.find_project(slug)?;
        match self
            .conn
            .query_row("SELECT profile_json FROM project_profiles WHERE project_id=?1", [project.id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
        {
            Some(value) => decode(&value),
            None => Ok(ProjectProfile::default()),
        }
    }
    /// Compact intake packet: selected references and counts, never file contents or a task dump.
    pub fn project_context(&self, slug: &str) -> Result<Value> {
        let project = self.find_project(slug)?;
        let profile = self.project_profile(slug)?;
        let mut stmt = self.conn.prepare("SELECT status,count(*) FROM tasks WHERE project_id=?1 GROUP BY status")?;
        let counts = stmt
            .query_map([project.id], |r| Ok((r.get::<_, String>(0)?, Value::from(r.get::<_, i64>(1)?))))?
            .collect::<rusqlite::Result<Map<String, Value>>>()?;
        let packet = json!({"project":project,"profile":profile,"task_counts":counts,"feedback":self.feedback_context(slug)?,"references_only":true,
            "guidance":"Proposed plans are not execution authority. Use search_tasks to select work, get_task_context before editing, and preserve existing plans. Human review owns Done."});
        if encode(&packet)?.len() > 1024 * 1024 {
            return Err(invalid("project context exceeds 1MiB; shorten the selected brief"));
        }
        Ok(packet)
    }
    pub fn save_project_profile(&self, slug: &str, mut p: ProjectProfile) -> Result<ProjectProfile> {
        p.category = p.category.trim().to_string();
        if p.category.is_empty() || p.category.len() > 256 || p.category.chars().any(char::is_control) {
            return Err(invalid("category must be 1–256 characters without controls"));
        }
        if !["active", "inactive", "review", "alias"].contains(&p.visibility.as_str()) {
            return Err(invalid("visibility must be active, inactive, review or alias"));
        }
        if encode(&p)?.len() > 256 * 1024 {
            return Err(invalid("project profile exceeds 256KiB"));
        }
        self.write(|c| {
            let project=self.find_project(slug)?; let old=self.project_profile(slug)?;
            let semantic=old.goal!=p.goal || old.source_revision!=p.source_revision || old.source_path!=p.source_path || old.allowed_scope!=p.allowed_scope || old.acceptance!=p.acceptance || old.budget!=p.budget || old.instructions!=p.instructions || old.skills!=p.skills || old.memories!=p.memories || old.context_notes!=p.context_notes;
            c.execute("INSERT INTO project_profiles(project_id,profile_json,semantic_revision,acceptance_required) VALUES(?1,?2,1,?4) ON CONFLICT(project_id) DO UPDATE SET profile_json=excluded.profile_json,semantic_revision=project_profiles.semantic_revision+?3,acceptance_required=max(project_profiles.acceptance_required,excluded.acceptance_required)",params![project.id,encode(&p)?,i64::from(semantic),!p.acceptance.trim().is_empty()])?;
            if semantic {
                let mut q=c.prepare("SELECT id FROM tasks WHERE project_id=?1")?;
                let ids=q.query_map([project.id],|r|r.get::<_,i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
                for id in ids { self.invalidate_acceptance(c,id,"project source, scope or acceptance changed")?; }
            }
            Ok(())
        })?;
        self.project_profile(slug)
    }
    pub fn task_plan(&self, id: i64) -> Result<TaskPlan> {
        self.get_task(id)?;
        match self
            .conn
            .query_row("SELECT plan_json FROM task_plans WHERE task_id=?1", [id], |r| r.get::<_, String>(0))
            .optional()?
        {
            Some(value) => decode(&value),
            None => Ok(TaskPlan::default()),
        }
    }
    pub fn save_task_plan(&self, id: i64, mut p: TaskPlan) -> Result<TaskPlan> {
        p.depends_on.sort_unstable();
        p.depends_on.dedup();
        if p.depends_on.len() > 256 || p.context_links.len() > 128 {
            return Err(invalid("too many dependencies or context links"));
        }
        for value in [&p.planned_start, &p.planned_end, &p.due_date].into_iter().flatten() {
            if !date(value) {
                return Err(invalid("dates must be valid YYYY-MM-DD calendar dates (Asia/Bangkok)"));
            }
        }
        if p.planned_start.as_ref().zip(p.planned_end.as_ref()).is_some_and(|(a, b)| a > b) {
            return Err(invalid("planned end is before planned start"));
        }
        if p.estimate_seconds.is_some_and(|n| n < 0) {
            return Err(invalid("estimate_seconds must be nonnegative or null"));
        }
        if encode(&p)?.len() > 256 * 1024 {
            return Err(invalid("task plan exceeds 256KiB"));
        }
        self.write(|c| {
            let task=self.get_task(id)?;
            let old=self.task_plan(id)?;
            let semantic=old.parent_id!=p.parent_id || old.depends_on!=p.depends_on || old.deliverable!=p.deliverable || old.acceptance!=p.acceptance || old.allowed_scope!=p.allowed_scope || old.budget!=p.budget || old.context_links!=p.context_links;
            for related in p.parent_id.iter().chain(p.depends_on.iter()) {
                if *related==id {return Err(invalid("a task cannot depend on or parent itself"));}
                if self.get_task(*related)?.project!=task.project {return Err(invalid("parent and dependency relationships must stay within one project"));}
            }
            if p.estimate_seconds.is_some() && !children(c,id)?.is_empty() {return Err(invalid("estimates belong to actionable leaves, not summary containers"));}
            if let Some(parent)=p.parent_id
                && self.task_plan(parent)?.estimate_seconds.is_some() {
                return Err(invalid("clear the parent's direct estimate before adding a subtask"));
            }
            c.execute("INSERT INTO task_plans(task_id,parent_id,plan_json,semantic_revision,acceptance_required) VALUES(?1,?2,?3,1,?5) ON CONFLICT(task_id) DO UPDATE SET parent_id=excluded.parent_id,plan_json=excluded.plan_json,semantic_revision=task_plans.semantic_revision+?4,acceptance_required=max(task_plans.acceptance_required,excluded.acceptance_required)",params![id,p.parent_id,encode(&p)?,i64::from(semantic),!p.acceptance.trim().is_empty()])?;
            c.execute("DELETE FROM task_dependencies WHERE task_id=?1",[id])?;
            for dep in &p.depends_on {c.execute("INSERT INTO task_dependencies(task_id,prerequisite_id) VALUES(?1,?2)",params![id,dep])?;}
            graph_valid(c)?;
            if semantic {self.invalidate_acceptance(c,id,"task scope, context or requirements changed")?;}
            if old.parent_id!=p.parent_id {
                for parent in old.parent_id.iter().chain(p.parent_id.iter()) {self.invalidate_acceptance(c,*parent,"required child membership changed")?;}
            }
            event(c,id,"plan",json!({"semantic_revision":revision(c,id)?,"semantic_change":semantic}))?;
            Ok(())
        })?;
        self.task_plan(id)
    }
    fn requirements_stamp(&self, c: &Connection, id: i64) -> Result<String> {
        let mut rows = Vec::new();
        for dep in requirements(c, id)? {
            let task = self.get_task(dep)?;
            let accepted: Option<i64> = c
                .query_row(
                    "SELECT id FROM task_acceptances WHERE task_id=?1 AND valid=1 ORDER BY id DESC LIMIT 1",
                    [dep],
                    |r| r.get(0),
                )
                .optional()?;
            rows.push(json!({"id":dep,"status":task.status,"revision":revision(c,dep)?,"project_revision":project_revision(c,dep)?,"acceptance":accepted}));
        }
        encode(&rows)
    }
    fn requires_acceptance(&self, id: i64) -> Result<bool> {
        let t = self.get_task(id)?;
        let sticky:bool=self.conn.query_row("SELECT coalesce(tp.acceptance_required,0) OR coalesce(pp.acceptance_required,0) FROM tasks t LEFT JOIN task_plans tp ON tp.task_id=t.id LEFT JOIN project_profiles pp ON pp.project_id=t.project_id WHERE t.id=?1",[id],|r|r.get(0))?;
        Ok(sticky
            || !self.task_plan(id)?.acceptance.trim().is_empty()
            || !self.project_profile(&t.project)?.acceptance.trim().is_empty())
    }
    pub(crate) fn accepted(&self, c: &Connection, id: i64) -> Result<bool> {
        if self.get_task(id)?.status != "done" {
            return Ok(false);
        }
        if !self.requires_acceptance(id)? {
            return Ok(true);
        }
        let row:Option<(i64,i64,String)>=c.query_row("SELECT semantic_revision,project_revision,requirements_json FROM task_acceptances WHERE task_id=?1 AND valid=1 ORDER BY id DESC LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        match row {
            Some((r, p, stamp)) => {
                Ok(r == revision(c, id)? && p == project_revision(c, id)? && stamp == self.requirements_stamp(c, id)?)
            }
            None => Ok(false),
        }
    }
    pub(crate) fn transition_guard(&self, c: &Connection, id: i64, status: &str, accepting: bool) -> Result<()> {
        if status != "doing" && status != "done" {
            return Ok(());
        }
        let task = self.get_task(id)?;
        if self.project_profile(&task.project)?.visibility != "active" {
            return Err(invalid("project is not active; restore it before execution/completion"));
        }
        let child_ids = children(c, id)?;
        if status == "doing" && !child_ids.is_empty() {
            return Err(invalid("summary containers are not executable; use an actionable subtask"));
        }
        for dep in requirements(c, id)? {
            if !self.accepted(c, dep)? {
                return Err(invalid(format!("task #{dep} is a required, unfinished or unaccepted prerequisite")));
            }
        }
        if status == "done" && self.requires_acceptance(id)? && !accepting && !self.accepted(c, id)? {
            return Err(invalid("structured acceptance is required; submit evidence through the acceptance action"));
        }
        Ok(())
    }
    pub(crate) fn touch_semantic(&self, c: &Connection, id: i64) -> Result<()> {
        c.execute("INSERT INTO task_plans(task_id,plan_json,semantic_revision) VALUES(?1,'{}',2) ON CONFLICT(task_id) DO UPDATE SET semantic_revision=semantic_revision+1",[id])?;
        self.invalidate_acceptance(c, id, "task title, description or project source changed")
    }
    pub(crate) fn invalidate_acceptance(&self, c: &Connection, id: i64, reason: &str) -> Result<()> {
        let mut q=c.prepare("WITH RECURSIVE edges(a,b) AS (SELECT parent_id,task_id FROM task_plans WHERE parent_id IS NOT NULL UNION SELECT task_id,prerequisite_id FROM task_dependencies), affected(id) AS (SELECT ?1 UNION SELECT edges.a FROM edges JOIN affected ON edges.b=affected.id) SELECT id FROM affected")?;
        let affected = q.query_map([id], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for task_id in affected {
            let had: i64 =
                c.query_row("SELECT count(*) FROM task_acceptances WHERE task_id=?1 AND valid=1", [task_id], |r| {
                    r.get(0)
                })?;
            c.execute("UPDATE task_acceptances SET valid=0 WHERE task_id=?1 AND valid=1", [task_id])?;
            if self.get_task(task_id)?.status == "done"
                && (had > 0 || self.requires_acceptance(task_id)? || !requirements(c, task_id)?.is_empty())
            {
                c.execute(
                    "UPDATE tasks SET status='review',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?1",
                    [task_id],
                )?;
            }
            if had > 0 {
                event(
                    c,
                    task_id,
                    "acceptance_stale",
                    json!({"reason":reason,"semantic_revision":revision(c,task_id)?}),
                )?;
            }
        }
        Ok(())
    }
    pub(crate) fn check_project_move(&self, c: &Connection, id: i64) -> Result<()> {
        let related:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM task_plans WHERE parent_id=?1 OR (task_id=?1 AND parent_id IS NOT NULL) UNION ALL SELECT 1 FROM task_dependencies WHERE task_id=?1 OR prerequisite_id=?1)",[id],|r|r.get(0))?;
        if related {
            Err(invalid("detach parent/child/dependency relationships before moving a task to another project"))
        } else {
            Ok(())
        }
    }
    pub fn create_subtask(&self, parent_id: i64, title: &str, description: &str) -> Result<Task> {
        let title = crate::store::clean_title(title)?;
        let id = self.write(|c| {
            let parent = self.get_task(parent_id)?;
            if self.project_profile(&parent.project)?.visibility != "active" {
                return Err(invalid("restore the project before adding a subtask"));
            }
            let project = self.find_project(&parent.project)?;
            if self.task_plan(parent_id)?.estimate_seconds.is_some() {
                return Err(invalid("clear the parent's direct estimate before adding a subtask"));
            }
            let position = Self::end_of_column(c, "todo", 0)?;
            c.execute(
                "INSERT INTO tasks(project_id,title,description,status,position) VALUES(?1,?2,?3,'todo',?4)",
                params![project.id, title, description.trim(), position],
            )?;
            let id = c.last_insert_rowid();
            let p = TaskPlan { parent_id: Some(parent_id), ..TaskPlan::default() };
            c.execute(
                "INSERT INTO task_plans(task_id,parent_id,plan_json) VALUES(?1,?2,?3)",
                params![id, parent_id, encode(&p)?],
            )?;
            graph_valid(c)?;
            self.invalidate_acceptance(c, parent_id, "required child added")?;
            Ok(id)
        })?;
        self.get_task(id)
    }
    pub fn accept_task(&self, id: i64, reviewer: &str, evidence: &str) -> Result<Value> {
        let reviewer = token(reviewer, "reviewer")?;
        let evidence = evidence.trim();
        if evidence.is_empty() || evidence.len() > 65536 {
            return Err(invalid("acceptance needs an evidence description/link of at most64KiB"));
        }
        self.write(|c| {
            self.transition_guard(c,id,"done",true)?;
            if self.accepted(c,id)? {
                let old:Option<(String,String)>=c.query_row("SELECT reviewer,evidence FROM task_acceptances WHERE task_id=?1 AND valid=1 ORDER BY id DESC LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
                if old.as_ref().is_some_and(|(r,e)|r==&reviewer && e==evidence) {return Ok(());}
            }
            let before=self.get_task(id)?;
            c.execute("UPDATE task_acceptances SET valid=0 WHERE task_id=?1 AND valid=1",[id])?;
            c.execute("INSERT INTO task_acceptances(task_id,semantic_revision,project_revision,requirements_json,reviewer,evidence) VALUES(?1,?2,?3,?4,?5,?6)",params![id,revision(c,id)?,project_revision(c,id)?,self.requirements_stamp(c,id)?,reviewer,evidence])?;
            c.execute("UPDATE tasks SET status='done',updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?1",[id])?;
            event(c,id,if before.status=="done"{"acceptance_updated"}else{"accepted"},json!({"reviewer":reviewer,"evidence":evidence,"semantic_revision":revision(c,id)?}))?;
            Ok(())
        })?;
        Ok(json!({"task":self.get_task(id)?,"accepted":self.accepted(&self.conn,id)?}))
    }
    fn time_entry(&self, id: i64) -> Result<Value> {
        self.conn.query_row("SELECT id,task_id,actor,kind,started_at,ended_at,seconds,note,request_id,recorded_at FROM task_time_entries WHERE id=?1",[id],time_row).optional()?.ok_or_else(||Error::NotFound(format!("no time entry #{id}")))
    }
    pub fn start_timer(&self, id: i64, actor: &str, request_id: &str) -> Result<Value> {
        let actor = token(actor, "actor")?;
        let request_id = token(request_id, "request_id")?;
        let entry=self.write(|c| {
            if let Some(entry)=c.query_row("SELECT id FROM task_time_entries WHERE actor=?1 AND request_id=?2",params![actor,request_id],|r|r.get::<_,i64>(0)).optional()? {
                let old=self.time_entry(entry)?;
                if old["task_id"]!=id || old["kind"]!="timer" {return Err(invalid("idempotency key already belongs to another measurement"));}
                return Ok(entry);
            }
            self.transition_guard(c,id,"doing",false)?;
            let open:Option<i64>=c.query_row("SELECT id FROM task_time_entries WHERE actor=?1 AND kind='timer' AND ended_at IS NULL",[&actor],|r|r.get(0)).optional()?;
            if let Some(open)=open {return Err(invalid(format!("actor already has running timer #{open}; stop it first")));}
            c.execute("INSERT INTO task_time_entries(task_id,actor,kind,started_at,request_id) VALUES(?1,?2,'timer',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3)",params![id,actor,request_id])?;
            Ok(c.last_insert_rowid())
        })?;
        self.time_entry(entry)
    }
    pub fn stop_timer(&self, entry_id: i64, actor: &str) -> Result<Value> {
        let actor = token(actor, "actor")?;
        self.write(|c| {
            let entry = self.time_entry(entry_id)?;
            if entry["actor"] != actor {
                return Err(invalid("only the timer's actor can stop it"));
            }
            if entry["kind"] != "timer" {
                return Err(invalid("this entry is manual effort, not a timer"));
            }
            if !entry["ended_at"].is_null() {
                return Ok(());
            }
            let seconds: i64 = c.query_row(
                "SELECT unixepoch('now')-unixepoch(started_at) FROM task_time_entries WHERE id=?1",
                [entry_id],
                |r| r.get(0),
            )?;
            if seconds < 0 {
                return Err(invalid("clock moved backwards; reconcile this timer"));
            }
            c.execute(
                "UPDATE task_time_entries SET ended_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),seconds=?1 WHERE id=?2",
                params![seconds, entry_id],
            )?;
            Ok(())
        })?;
        self.time_entry(entry_id)
    }
    pub fn add_manual_time(&self, id: i64, actor: &str, seconds: i64, note: &str, request_id: &str) -> Result<Value> {
        let actor = token(actor, "actor")?;
        let request_id = token(request_id, "request_id")?;
        let note = note.trim();
        if seconds < 0 || note.is_empty() || note.len() > 65536 {
            return Err(invalid("manual time needs nonnegative seconds and an explanatory note"));
        }
        let entry=self.write(|c| {
            self.get_task(id)?;
            if let Some(entry)=c.query_row("SELECT id FROM task_time_entries WHERE actor=?1 AND request_id=?2",params![actor,request_id],|r|r.get::<_,i64>(0)).optional()? {
                let old=self.time_entry(entry)?;
                if old["task_id"]!=id || old["kind"]!="manual" || old["seconds"]!=seconds || old["note"]!=note {return Err(invalid("idempotency key conflicts with an existing measurement"));}
                return Ok(entry);
            }
            c.execute("INSERT INTO task_time_entries(task_id,actor,kind,ended_at,seconds,note,request_id) VALUES(?1,?2,'manual',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3,?4,?5)",params![id,actor,seconds,note,request_id])?;
            Ok(c.last_insert_rowid())
        })?;
        self.time_entry(entry)
    }
    pub fn harness_snapshot(&self) -> Result<Value> {
        // Check stored payload sizes before allocating a whole-portfolio reply.
        // History row limits alone do not bound long profile/evidence strings.
        let payload_bytes: i64 = self.conn.query_row(
            "SELECT coalesce((SELECT sum(length(CAST(profile_json AS BLOB))) FROM project_profiles),0) + coalesce((SELECT sum(length(CAST(plan_json AS BLOB))) FROM task_plans),0) + coalesce((SELECT sum(length(CAST(details AS BLOB))) FROM (SELECT details FROM task_events ORDER BY id DESC LIMIT 500)),0) + coalesce((SELECT sum(length(CAST(note AS BLOB))+length(actor)+length(request_id)) FROM (SELECT note,actor,request_id FROM task_time_entries ORDER BY id DESC LIMIT 500)),0)",
            [], |r| r.get(0),
        )?;
        let record_count: i64 =
            self.conn
                .query_row("SELECT (SELECT count(*) FROM projects)+(SELECT count(*) FROM tasks)", [], |r| r.get(0))?;
        if payload_bytes > 4 * 1024 * 1024 || record_count > 10_000 {
            return Err(invalid(
                "portfolio snapshot exceeds its 4MiB stored-payload/10000-record budget; use selected project/task endpoints and reduce oversized context",
            ));
        }
        let mut profiles = Map::new();
        for p in self.list_projects()? {
            profiles.insert(p.slug.clone(), json!(self.project_profile(&p.slug)?));
        }
        let mut plans = Map::new();
        let mut ids = self.conn.prepare("SELECT id FROM tasks ORDER BY id")?;
        for id in ids.query_map([], |r| r.get::<_, i64>(0))? {
            let id = id?;
            plans.insert(id.to_string(), json!(self.task_plan(id)?));
        }
        let mut q=self.conn.prepare("SELECT id,task_id,actor,kind,started_at,ended_at,seconds,note,request_id,recorded_at FROM task_time_entries ORDER BY id DESC LIMIT 500")?;
        let mut entries = q.query_map([], time_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        entries.reverse();
        // An open timer must remain stoppable even when it predates the recent
        // history window. Prefer the UI's human actor in this bounded list.
        let mut q = self.conn.prepare("SELECT id,task_id,actor,kind,started_at,ended_at,seconds,note,request_id,recorded_at FROM task_time_entries WHERE kind='timer' AND ended_at IS NULL ORDER BY (actor='human') DESC,id LIMIT 128")?;
        let active_timers = q.query_map([], time_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut q = self.conn.prepare(
            "SELECT id,task_id,kind,from_status,to_status,at,details FROM task_events ORDER BY id DESC LIMIT 500",
        )?;
        let mut events = q.query_map([], event_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        events.reverse();
        let time_total: i64 = self.conn.query_row("SELECT count(*) FROM task_time_entries", [], |r| r.get(0))?;
        let event_total: i64 = self.conn.query_row("SELECT count(*) FROM task_events", [], |r| r.get(0))?;
        let mut totals = Map::new();
        let mut total_seconds = 0_i64;
        let mut timer_seconds = 0_i64;
        let mut manual_seconds = 0_i64;
        let mut q=self.conn.prepare("SELECT task_id,coalesce(sum(seconds),0),coalesce(sum(CASE WHEN kind='timer' THEN seconds ELSE 0 END),0),coalesce(sum(CASE WHEN kind='manual' THEN seconds ELSE 0 END),0),count(*),sum(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) FROM task_time_entries GROUP BY task_id")?;
        for row in q.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })? {
            let (id, seconds, timer, manual, count, open) = row?;
            total_seconds = total_seconds
                .checked_add(seconds)
                .ok_or_else(|| invalid("recorded effort exceeds supported duration total"))?;
            timer_seconds = timer_seconds
                .checked_add(timer)
                .ok_or_else(|| invalid("recorded timer effort exceeds supported duration total"))?;
            manual_seconds = manual_seconds
                .checked_add(manual)
                .ok_or_else(|| invalid("recorded manual effort exceeds supported duration total"))?;
            totals.insert(id.to_string(),json!({"seconds":seconds,"timer_seconds":timer,"manual_seconds":manual,"entries":count,"open_timers":open}));
        }
        let mut q = self
            .conn
            .prepare("SELECT task_id,actor,coalesce(sum(seconds),0) FROM task_time_entries GROUP BY task_id,actor")?;
        for row in q.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
            let (id, actor, seconds) = row?;
            if let Some(total) = totals.get_mut(&id.to_string()).and_then(Value::as_object_mut) {
                total
                    .entry("by_actor")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .expect("object just created")
                    .insert(actor, json!(seconds));
            }
        }
        Ok(
            json!({"profiles":profiles,"plans":plans,"time_entries":entries,"active_timers":active_timers,"events":events,"timezone":"Asia/Bangkok","duration_unit":"seconds","history_window":{"time_entries":{"total":time_total,"returned":entries.len(),"limit":500,"truncated":time_total>entries.len() as i64},"events":{"total":event_total,"returned":events.len(),"limit":500,"truncated":event_total>events.len() as i64}},"time_totals":{"seconds":total_seconds,"timer_seconds":timer_seconds,"manual_seconds":manual_seconds,"by_task":totals}}),
        )
    }
    pub fn task_context(&self, id: i64) -> Result<Value> {
        let task = self.get_task(id)?;
        let plan = self.task_plan(id)?;
        let mut ancestors = Vec::new();
        let mut parent = plan.parent_id;
        while let Some(id) = parent {
            if ancestors.len() >= 16 {
                break;
            }
            let p = self.task_plan(id)?;
            ancestors.push(json!({"task":task_summary(&self.get_task(id)?),"plan":p}));
            parent = p.parent_id;
        }
        let ancestor_total:i64=self.conn.query_row("WITH RECURSIVE ancestors(id) AS (SELECT parent_id FROM task_plans WHERE task_id=?1 AND parent_id IS NOT NULL UNION ALL SELECT p.parent_id FROM task_plans p JOIN ancestors a ON p.task_id=a.id WHERE p.parent_id IS NOT NULL) SELECT count(*) FROM ancestors",[id],|r|r.get(0))?;
        let mut child_rows = Vec::new();
        let child_total: i64 =
            self.conn.query_row("SELECT count(*) FROM task_plans WHERE parent_id=?1", [id], |r| r.get(0))?;
        let mut q = self.conn.prepare("SELECT task_id FROM task_plans WHERE parent_id=?1 ORDER BY task_id LIMIT 50")?;
        for child in q.query_map([id], |r| r.get::<_, i64>(0))? {
            let child = child?;
            child_rows.push(json!({"task":task_summary(&self.get_task(child)?),"plan":self.task_plan(child)?,"accepted":self.accepted(&self.conn,child)?}));
        }
        let mut dependencies = Vec::new();
        for dep in plan.depends_on.iter().take(50) {
            dependencies
                .push(json!({"task":task_summary(&self.get_task(*dep)?),"accepted":self.accepted(&self.conn,*dep)?}));
        }
        let mut q=self.conn.prepare("SELECT id,task_id,actor,kind,started_at,ended_at,seconds,note,request_id,recorded_at FROM task_time_entries WHERE task_id=?1 ORDER BY id DESC LIMIT 50")?;
        let mut time = q.query_map([id], time_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        time.reverse();
        let mut q=self.conn.prepare("SELECT id,task_id,kind,from_status,to_status,at,details FROM task_events WHERE task_id=?1 ORDER BY id DESC LIMIT 50")?;
        let mut events = q.query_map([id], event_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        events.reverse();
        let time_total: i64 =
            self.conn.query_row("SELECT count(*) FROM task_time_entries WHERE task_id=?1", [id], |r| r.get(0))?;
        let event_total: i64 =
            self.conn.query_row("SELECT count(*) FROM task_events WHERE task_id=?1", [id], |r| r.get(0))?;
        let value = json!({"task":task,"project":self.find_project(&task.project)?,"profile":self.project_profile(&task.project)?,"plan":plan,"semantic_revision":revision(&self.conn,id)?,"ancestors":ancestors,"children":child_rows,"dependencies":dependencies,"time_entries":time,"events":events,"accepted":self.accepted(&self.conn,id)?,"references_only":true,"feedback":self.feedback_context(&task.project)?,"context_window":{"ancestors":{"total":ancestor_total,"returned":ancestors.len(),"truncated":ancestor_total>ancestors.len() as i64},"children":{"total":child_total,"returned":child_rows.len(),"truncated":child_total>child_rows.len() as i64},"dependencies":{"total":plan.depends_on.len(),"returned":dependencies.len(),"truncated":plan.depends_on.len()>dependencies.len()},"time_entries":{"total":time_total,"returned":time.len(),"truncated":time_total>time.len() as i64},"events":{"total":event_total,"returned":events.len(),"truncated":event_total>events.len() as i64}}});
        if encode(&value)?.len() > 256 * 1024 {
            return Err(invalid(
                "selected context packet exceeds 256KiB; shorten project/task context or retrieve individual records",
            ));
        }
        Ok(value)
    }
}
fn task_summary(t: &Task) -> Value {
    json!({"id":t.id,"project":t.project,"title":t.title,"status":t.status,"human":t.human})
}
fn time_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(
        json!({"id":r.get::<_,i64>(0)?,"task_id":r.get::<_,i64>(1)?,"actor":r.get::<_,String>(2)?,"kind":r.get::<_,String>(3)?,"started_at":r.get::<_,Option<String>>(4)?,"ended_at":r.get::<_,Option<String>>(5)?,"seconds":r.get::<_,Option<i64>>(6)?,"note":r.get::<_,String>(7)?,"request_id":r.get::<_,String>(8)?,"recorded_at":r.get::<_,String>(9)?}),
    )
}
fn event_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let details: String = r.get(6)?;
    Ok(
        json!({"id":r.get::<_,i64>(0)?,"task_id":r.get::<_,Option<i64>>(1)?,"kind":r.get::<_,String>(2)?,"from_status":r.get::<_,Option<String>>(3)?,"to_status":r.get::<_,Option<String>>(4)?,"at":r.get::<_,String>(5)?,"details":serde_json::from_str::<Value>(&details).unwrap_or(Value::Null)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::TaskPatch;
    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(&d.path().join("kanzo.db"), None).unwrap();
        s.migrate().unwrap();
        (d, s)
    }
    #[test]
    fn profile_plan_dates_and_context() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let t = s.create_task(p.id, "task", "kept description").unwrap();
        let changes = s.changes().unwrap();
        let profile =
            ProjectProfile { goal: "Purpose".into(), skills: vec!["selected-skill-path".into()], ..Default::default() };
        s.save_project_profile("a", profile.clone()).unwrap();
        assert!(s.changes().unwrap() > changes);
        let mut plan = TaskPlan { planned_start: Some("2026-02-29".into()), ..Default::default() };
        assert!(s.save_task_plan(t.id, plan.clone()).is_err());
        plan.planned_start = Some("2026-11-02".into());
        s.save_task_plan(t.id, plan).unwrap();
        let context = s.task_context(t.id).unwrap();
        assert_eq!(context["task"]["description"], "kept description");
        assert_eq!(context["profile"]["goal"], "Purpose");
        assert_eq!(context["references_only"], true);
    }
    #[test]
    fn combined_cycles_and_cross_project_rejected_atomically() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let q = s.create_project("b", "", None).unwrap();
        let parent = s.create_task(p.id, "parent", "").unwrap();
        let child = s.create_subtask(parent.id, "child", "").unwrap();
        let other = s.create_task(q.id, "other", "").unwrap();
        let cycle = TaskPlan { parent_id: Some(parent.id), depends_on: vec![parent.id], ..Default::default() };
        assert!(s.save_task_plan(child.id, cycle).is_err());
        assert!(s.task_plan(child.id).unwrap().depends_on.is_empty());
        assert!(s.save_task_plan(child.id, TaskPlan { depends_on: vec![other.id], ..Default::default() }).is_err());
        assert!(s.next_task(Some(p.id)).unwrap().is_some_and(|t| t.id == child.id));
    }
    #[test]
    fn all_transition_paths_obey_acceptance_and_project_eligibility() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let dep = s.create_task(p.id, "dep", "").unwrap();
        let t = s.create_task(p.id, "work", "").unwrap();
        s.save_task_plan(
            t.id,
            TaskPlan { depends_on: vec![dep.id], acceptance: "evidence required".into(), ..Default::default() },
        )
        .unwrap();
        assert!(s.move_task(t.id, "doing", None).is_err());
        s.move_task(dep.id, "done", None).unwrap();
        assert!(s.update_task(t.id, TaskPatch { status: Some("done".into()), ..Default::default() }).is_err());
        s.accept_task(t.id, "owner", "source-bound check passed").unwrap();
        assert_eq!(s.get_task(t.id).unwrap().status, "done");
        s.update_task(t.id, TaskPatch { description: Some("changed scope".into()), ..Default::default() }).unwrap();
        assert_eq!(s.get_task(t.id).unwrap().status, "review");
        s.save_project_profile("a", ProjectProfile { visibility: "inactive".into(), ..Default::default() }).unwrap();
        assert!(s.move_task(dep.id, "doing", None).is_err());
        assert!(s.next_task(None).unwrap().is_none());
    }
    #[test]
    fn timers_are_idempotent_and_survive_reopen() {
        let (d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let t = s.create_task(p.id, "work", "").unwrap();
        let u = s.create_task(p.id, "other", "").unwrap();
        let entry = s.start_timer(t.id, "human:owner", "start-1").unwrap();
        assert_eq!(s.start_timer(t.id, "human:owner", "start-1").unwrap(), entry);
        assert!(s.start_timer(u.id, "human:owner", "start-2").is_err());
        drop(s);
        let s = Store::open(&d.path().join("kanzo.db"), None).unwrap();
        s.migrate().unwrap();
        let id = entry["id"].as_i64().unwrap();
        assert!(s.stop_timer(id, "someone-else").is_err());
        let ended = s.stop_timer(id, "human:owner").unwrap();
        assert_eq!(s.stop_timer(id, "human:owner").unwrap(), ended);
        let manual = s.add_manual_time(t.id, "human:owner", 60, "reported effort", "manual-1").unwrap();
        assert!(manual["started_at"].is_null());
        assert_eq!(s.add_manual_time(t.id, "human:owner", 60, "reported effort", "manual-1").unwrap(), manual);
        assert!(s.add_manual_time(t.id, "human:owner", 61, "reported effort", "manual-1").is_err());
        assert_eq!(s.harness_snapshot().unwrap()["time_entries"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn clearing_criteria_does_not_remove_acceptance_gate() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let t = s.create_task(p.id, "work", "").unwrap();
        s.save_task_plan(t.id, TaskPlan { acceptance: "source-bound check".into(), ..Default::default() }).unwrap();
        s.save_task_plan(t.id, TaskPlan::default()).unwrap();
        assert!(s.move_task(t.id, "done", None).is_err());
        s.accept_task(t.id, "owner", "evidence reviewed").unwrap();
        assert_eq!(s.get_task(t.id).unwrap().status, "done");
        let u = s.create_task(p.id, "second", "").unwrap();
        s.save_project_profile(
            "a",
            ProjectProfile { visibility: "active".into(), acceptance: "project check".into(), ..Default::default() },
        )
        .unwrap();
        s.save_project_profile("a", ProjectProfile { visibility: "active".into(), ..Default::default() }).unwrap();
        assert!(s.update_task(u.id, TaskPatch { status: Some("done".into()), ..Default::default() }).is_err());
    }
    #[test]
    fn parent_preserves_direct_effort_and_child_changes_invalidate_acceptance() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let parent = s.create_task(p.id, "parent", "").unwrap();
        s.add_manual_time(parent.id, "human", 30, "coordination", "p1").unwrap();
        let child = s.create_subtask(parent.id, "child", "").unwrap();
        assert!(s.move_task(parent.id, "doing", None).is_err());
        assert!(s.accept_task(parent.id, "owner", "premature").is_err());
        s.move_task(child.id, "done", None).unwrap();
        s.save_task_plan(parent.id, TaskPlan { acceptance: "children reviewed".into(), ..Default::default() }).unwrap();
        s.accept_task(parent.id, "owner", "all required children checked").unwrap();
        s.update_task(child.id, TaskPatch { description: Some("revised child scope".into()), ..Default::default() })
            .unwrap();
        assert_eq!(s.get_task(parent.id).unwrap().status, "review");
        assert!(!s.task_context(parent.id).unwrap()["accepted"].as_bool().unwrap());
        let snapshot = s.harness_snapshot().unwrap();
        assert_eq!(snapshot["time_totals"]["seconds"], 30);
        assert_eq!(snapshot["time_totals"]["by_task"][parent.id.to_string()]["by_actor"]["human"], 30);
    }
    #[test]
    fn migration_does_not_invent_old_events() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("kanzo.db");
        let c = Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);").unwrap();
        c.execute_batch(include_str!("schema.sql")).unwrap();
        c.execute("INSERT INTO meta(key,value) VALUES('schema_version','1'),('compatible','1')", []).unwrap();
        c.execute("INSERT INTO projects(slug,name) VALUES('a','A')", []).unwrap();
        c.execute(
            "INSERT INTO tasks(project_id,title,description,status,position) VALUES(1,'Original','Keep','todo',1)",
            [],
        )
        .unwrap();
        drop(c);
        let s = Store::open(&db, None).unwrap();
        s.migrate().unwrap();
        assert_eq!(s.get_task(1).unwrap().description, "Keep");
        assert!(s.harness_snapshot().unwrap()["events"].as_array().unwrap().is_empty());
        assert_eq!(s.project_profile("a").unwrap().visibility, "review");
        assert!(s.next_task(None).unwrap().is_none());
    }
    #[test]
    fn raw_stock_writer_is_rejected_but_reads_and_fork_writes_work() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("kanzo.db");
        let old = Connection::open(&db).unwrap();
        let s = Store::open(&db, None).unwrap();
        s.migrate().unwrap();
        let p = s.create_project("a", "", None).unwrap();
        let t = s.create_task(p.id, "original", "").unwrap();
        assert_eq!(
            old.query_row("SELECT title FROM tasks WHERE id=?1", [t.id], |r| r.get::<_, String>(0)).unwrap(),
            "original"
        );
        assert!(old.execute("UPDATE tasks SET status='done' WHERE id=?1", [t.id]).is_err());
        assert!(old.execute("INSERT INTO projects(slug,name) VALUES('old','old')", []).is_err());
        assert!(old.execute("DELETE FROM tasks WHERE id=?1", [t.id]).is_err());
        s.update_task(t.id, TaskPatch { description: Some("fork allowed".into()), ..Default::default() }).unwrap();
        assert_eq!(s.get_task(t.id).unwrap().description, "fork allowed");
    }
    #[test]
    fn history_is_bounded_without_truncating_total_effort() {
        let (_d, s) = store();
        let p = s.create_project("a", "", None).unwrap();
        let t = s.create_task(p.id, "work", "").unwrap();
        let running = s.start_timer(t.id, "human", "old-open-timer").unwrap();
        s.write(|c|{for i in 0..501 {c.execute("INSERT INTO task_time_entries(task_id,actor,kind,ended_at,seconds,note,request_id) VALUES(?1,'human','manual',strftime('%Y-%m-%dT%H:%M:%SZ','now'),1,'reported',?2)",params![t.id,format!("entry-{i}")])?;}Ok(())}).unwrap();
        let snapshot = s.harness_snapshot().unwrap();
        assert_eq!(snapshot["time_entries"].as_array().unwrap().len(), 500);
        assert_eq!(snapshot["history_window"]["time_entries"]["truncated"], true);
        assert_eq!(snapshot["time_totals"]["seconds"], 501);
        assert_eq!(snapshot["active_timers"][0]["id"], running["id"]);
        let context = s.task_context(t.id).unwrap();
        assert_eq!(context["time_entries"].as_array().unwrap().len(), 50);
        assert_eq!(context["context_window"]["time_entries"]["total"], 502);
        s.stop_timer(running["id"].as_i64().unwrap(), "human").unwrap();
    }

    #[test]
    fn oversized_portfolio_payload_is_rejected_before_snapshot_materialization() {
        let (_d, s) = store();
        for i in 0..20 {
            let slug = format!("large-{i}");
            s.create_project(&slug, "", None).unwrap();
            s.save_project_profile(&slug, ProjectProfile { goal: "x".repeat(220_000), ..Default::default() }).unwrap();
        }
        assert!(s.harness_snapshot().unwrap_err().to_string().contains("snapshot exceeds"));
    }
}
