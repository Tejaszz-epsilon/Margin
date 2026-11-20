const DEFAULTS = {
  mode: "auto",
  provider: "anthropic",
  key: "",
  model: "",
  search: true,
  depth: "auto",
  remember: true,
};

const $ = (id) => document.getElementById(id);

/* Where to get a key, per provider. Written out because "add your API key" is
   useless advice if you've never made one. */
const KEY_HELP = {
  anthropic: {
    text: "Get one at console.anthropic.com \u2192 Settings \u2192 API keys \u2192 Create key. Requires billing credit on the account. Keys start with sk-ant-.",
    url: "https://console.anthropic.com/settings/keys",
    model: "claude-sonnet-5",
  },
  gemini: {
    text: "Get one free at aistudio.google.com \u2192 Get API key \u2192 Create API key. No credit card needed. Note: on Google's free tier, your prompts and the article text may be used to improve their models \u2014 the paid tier removes that.",
    url: "https://aistudio.google.com/apikey",
    model: "gemini-2.5-flash",
  },
  openai: {
    text: "Get one at platform.openai.com \u2192 API keys \u2192 Create new secret key. Requires billing credit. Web search isn't wired up for OpenAI yet.",
    url: "https://platform.openai.com/api-keys",
    model: "gpt-4o-mini",
  },
};

function paintProviderHelp() {
  const p = $("provider").value;
  const h = KEY_HELP[p] || KEY_HELP.anthropic;
  const help = $("keyhelp");
  help.textContent = h.text + " ";
  const a = document.createElement("a");
  a.href = h.url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = "Open \u2197";
  a.style.color = "var(--slate)";
  help.appendChild(a);

  $("model").placeholder = h.model;
  $("searchwhy").textContent =
    p === "openai"
      ? "Not available for OpenAI yet \u2014 switch to Anthropic or Gemini for web search."
      : "Answers drawn from elsewhere are labelled in the panel.";
  $("search").disabled = p === "openai";
}

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  document.querySelector(`input[name=mode][value="${s.mode}"]`).checked = true;
  $("provider").value = s.provider;
  $("key").value = s.key;
  $("model").value = s.model;
  $("search").checked = s.search;
  $("depth").value = s.depth;
  $("remember").checked = s.remember;
  paintProviderHelp();
  paintProfile();
}

async function save() {
  await chrome.storage.local.set({
    mode: document.querySelector("input[name=mode]:checked").value,
    provider: $("provider").value,
    key: $("key").value.trim(),
    model: $("model").value.trim(),
    search: $("search").checked,
    depth: $("depth").value,
    remember: $("remember").checked,
  });
  const tag = $("saved");
  tag.classList.add("on");
  setTimeout(() => tag.classList.remove("on"), 1400);
}

function paintProfile() {
  chrome.runtime.sendMessage({ type: "library" }, (res) => {
    if (chrome.runtime.lastError || !res?.profile) return;
    const p = res.profile;
    $("profilenote").textContent = p.count
      ? `Learned from ${p.count} article(s) so far: ${p.label} (${p.tech.toFixed(2)} on a 0\u20131 scale).`
      : "Nothing read yet \u2014 Margin will use the current page's own level until it has history.";
  });
}

async function forget() {
  await chrome.storage.local.set({ library: [] });
  $("profilenote").textContent = "Reading history cleared.";
}

async function reportAvailability() {
  const box = $("avail");
  if (typeof LanguageModel === "undefined") {
    box.innerHTML =
      "This browser doesn't expose the on-device model. You'll need <b>Chrome 138 or newer</b> \u2014 or just add a key below.";
    return;
  }
  try {
    const a = await LanguageModel.availability();
    box.innerHTML =
      a === "available"
        ? "On-device model is <b>ready</b>. Margin works with no key and no network."
        : a === "downloadable" || a === "downloading"
        ? "On-device model is <b>not downloaded yet</b>. It'll fetch itself the first time you ask a question."
        : "On-device model is <b>unavailable</b> on this machine. Add a key below to use Margin.";
  } catch {
    box.textContent = "Couldn't check the on-device model on this build.";
  }
}

$("save").addEventListener("click", save);
$("forget").addEventListener("click", forget);
$("provider").addEventListener("change", paintProviderHelp);
load();
reportAvailability();
