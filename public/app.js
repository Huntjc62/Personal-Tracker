import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const PALETTE = [
  { bg: "#3C4A3E", ring: "#8AA893" },
  { bg: "#7A4A32", ring: "#C99A79" },
  { bg: "#2E3A56", ring: "#8CA0C9" },
  { bg: "#4B3350", ring: "#B291BC" },
  { bg: "#6B3A2E", ring: "#D19277" },
];

const STATUS_ORDER = ["todo", "doing", "done"];
const STATUS_LABEL = { todo: "Not started", doing: "In progress", done: "Done" };
const STATUS_ICON = { todo: "○", doing: "◐", done: "✓" };
const STATUS_COLOR = { todo: "#9A9184", doing: "#B8813F", done: "#3C6E4A" };

// ---- Firebase setup ----

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const state = {
  projects: [],
  activeId: null,
  loaded: false,
  authFailed: false,
  syncFailed: false,
};

let userDocRef = null;
let unsubscribeSnapshot = null;
let writeInFlight = false; // suppress re-render flicker from our own optimistic writes

const app = document.getElementById("app");

// ---- Firestore read/write ----

async function persist(nextProjects) {
  state.projects = nextProjects;
  render();
  if (!userDocRef) return;
  writeInFlight = true;
  try {
    await setDoc(userDocRef, { projects: nextProjects, updatedAt: Date.now() });
    state.syncFailed = false;
  } catch (e) {
    console.error("Failed to save to Firestore:", e);
    state.syncFailed = true;
    render();
  } finally {
    writeInFlight = false;
  }
}

function startListening(userId) {
  userDocRef = doc(db, "users", userId, "tracker", "data");
  unsubscribeSnapshot = onSnapshot(
    userDocRef,
    (snap) => {
      if (writeInFlight) return; // our own write already updated local state
      state.loaded = true;
      state.syncFailed = false;
      state.projects = snap.exists() ? snap.data().projects || [] : [];
      if (!state.activeId && state.projects.length) state.activeId = state.projects[0].id;
      render();
    },
    (err) => {
      console.error("Firestore listener error:", err);
      state.loaded = true;
      state.syncFailed = true;
      render();
    }
  );
}

// ---- actions ----

function progressOf(project) {
  if (!project.tasks.length) return 0;
  return Math.round(
    (project.tasks.filter((t) => t.status === "done").length / project.tasks.length) * 100
  );
}

function activeProject() {
  return state.projects.find((p) => p.id === state.activeId) || null;
}

function recentTasks() {
  return state.projects
    .flatMap((p) => p.tasks.map((t) => ({ ...t, projectName: p.name, projectColor: p.color })))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);
}

function addProject(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const project = {
    id: uid(),
    name: trimmed,
    color: PALETTE[state.projects.length % PALETTE.length],
    tasks: [],
    createdAt: Date.now(),
  };
  state.activeId = project.id;
  persist([...state.projects, project]);
}

function deleteProject(id) {
  const next = state.projects.filter((p) => p.id !== id);
  if (state.activeId === id) state.activeId = next.length ? next[0].id : null;
  persist(next);
}

function addTask(projectId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const task = { id: uid(), text: trimmed, status: "todo", createdAt: Date.now() };
  const next = state.projects.map((p) =>
    p.id === projectId ? { ...p, tasks: [task, ...p.tasks] } : p
  );
  persist(next);
}

function setTaskStatus(projectId, taskId, status) {
  const next = state.projects.map((p) =>
    p.id === projectId
      ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) }
      : p
  );
  persist(next);
}

function deleteTask(projectId, taskId) {
  const next = state.projects.map((p) =>
    p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p
  );
  persist(next);
}

// ---- rendering (DOM helpers) ----

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function renderSidebar() {
  const list = el("div", { class: "project-list" });
  for (const p of state.projects) {
    const pct = progressOf(p);
    list.appendChild(
      el(
        "button",
        {
          class: `project-item btn${p.id === state.activeId ? " active" : ""}`,
          onclick: () => { state.activeId = p.id; render(); },
        },
        [
          el("div", { class: "project-item-top" }, [
            el("span", { class: "dot", style: `background:${p.color.bg}` }),
            el("span", { class: "name", text: p.name }),
            el("span", { class: "pct", text: `${pct}%` }),
          ]),
          el("div", { class: "progress-bar" }, [
            el("div", { class: "progress-bar-fill", style: `width:${pct}%;background:${p.color.bg}` }),
          ]),
        ]
      )
    );
  }

  const newProjectArea = el("div", { id: "new-project-area" });
  const toggleBtn = el("button", {
    class: "new-project-toggle btn",
    text: "+ New project",
    onclick: () => {
      newProjectArea.innerHTML = "";
      const input = el("input", { placeholder: "Project name" });
      const submit = () => addProject(input.value);
      input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
      newProjectArea.appendChild(
        el("div", { class: "new-project-form" }, [input, el("button", { class: "btn", text: "✓", onclick: submit })])
      );
      input.focus();
    },
  });
  newProjectArea.appendChild(toggleBtn);

  return el("div", { class: "sidebar" }, [list, newProjectArea]);
}

function renderMain() {
  const project = activeProject();
  if (!project) {
    return el("div", { class: "main" }, [
      el("div", { class: "empty-state", text: "Add a project on the left to start tracking tasks." }),
    ]);
  }

  const doneCount = project.tasks.filter((t) => t.status === "done").length;

  const header = el("div", { class: "project-header" }, [
    el("div", {}, [
      el("h2", { text: project.name }),
      el("div", { class: "subtitle", text: `${doneCount} of ${project.tasks.length} tasks done` }),
    ]),
    el("button", {
      class: "remove-project-btn btn",
      text: "🗑 Remove project",
      onclick: () => deleteProject(project.id),
    }),
  ]);

  const taskInput = el("input", { placeholder: "Add a task…" });
  const submitTask = () => addTask(project.id, taskInput.value);
  taskInput.addEventListener("keydown", (e) => e.key === "Enter" && submitTask());
  const newTaskForm = el("div", { class: "new-task-form" }, [
    taskInput,
    el("button", { class: "btn", text: "+", style: `background:${project.color.bg}`, onclick: submitTask }),
  ]);

  const taskList = el("div", { class: "task-list" });
  if (!project.tasks.length) {
    taskList.appendChild(el("div", { class: "empty-state", text: "No tasks yet — add the first one above." }));
  }
  for (const t of project.tasks) {
    const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(t.status) + 1) % 3];
    const toggle = el("button", {
      class: "status-toggle btn",
      style: `border-color:${STATUS_COLOR[t.status]};color:${t.status === "done" ? "#F7F3EA" : STATUS_COLOR[t.status]};background:${t.status === "done" ? STATUS_COLOR[t.status] : "transparent"}`,
      text: STATUS_ICON[t.status],
      title: `Mark as ${STATUS_LABEL[nextStatus]}`,
      onclick: () => setTaskStatus(project.id, t.id, nextStatus),
    });
    taskList.appendChild(
      el("div", { class: "task-row" }, [
        toggle,
        el("span", { class: `task-text${t.status === "done" ? " done" : ""}`, text: t.text }),
        el("span", { class: "task-status-label", text: STATUS_LABEL[t.status] }),
        el("button", { class: "task-delete btn", text: "✕", onclick: () => deleteTask(project.id, t.id) }),
      ])
    );
  }

  return el("div", { class: "main" }, [header, newTaskForm, taskList]);
}

function renderRail() {
  const recent = recentTasks();
  const body = recent.length
    ? recent.map((t) =>
        el("div", { class: "recent-item" }, [
          el("div", { class: "rtext", text: t.text }),
          el("div", { class: "rmeta" }, [
            el("span", { class: "dot", style: `background:${t.projectColor.bg}` }),
            document.createTextNode(t.projectName),
          ]),
        ])
      )
    : [el("div", { class: "rail-empty", text: "Nothing logged yet." })];

  return el("div", { class: "rail" }, [el("div", { class: "rail-title", text: "📥 Recently added" }), ...body]);
}

function render() {
  app.innerHTML = "";

  if (state.authFailed) {
    app.appendChild(
      el("div", { class: "error-screen" }, [
        el("div", { text: "Couldn't sign in to Firebase. Check that Anonymous auth is enabled in your Firebase project (Authentication → Sign-in method), and that firebase-config.js has the right values." }),
      ])
    );
    return;
  }

  if (!state.loaded) {
    app.appendChild(el("div", { class: "loading", text: "Loading your ledger…" }));
    return;
  }

  const header = el("div", { class: "header" }, [
    el("div", {
      class: "date",
      text: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    }),
    el("h1", { text: "Project ledger" }),
  ]);
  app.appendChild(header);

  if (state.syncFailed) {
    app.appendChild(
      el("div", { class: "load-error-banner" }, [
        el("span", { text: "Couldn't sync with Firestore — check your connection and Firestore security rules." }),
      ])
    );
  }

  app.appendChild(el("div", { class: "layout" }, [renderSidebar(), renderMain(), renderRail()]));
}

// ---- boot ----

onAuthStateChanged(auth, (user) => {
  if (user) {
    startListening(user.uid);
  }
});

signInAnonymously(auth).catch((e) => {
  console.error("Anonymous sign-in failed:", e);
  state.authFailed = true;
  state.loaded = true;
  render();
});

render();
