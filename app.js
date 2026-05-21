let token = null;
let user = null;
let currentFolder = null;
let replyToMessage = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingInterval = null;
let ws = null;
let weeklyChart = null;

// ========== ВХОД/ВЫХОД ==========
async function doLogin() {
  const login = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  if (!login || !password) {
    alert("Введите логин/email и пароль");
    return;
  }

  try {
    const resp = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: login, password }),
    });
    const data = await resp.json();

    if (data.success) {
      token = data.token;
      user = data.user;
      sessionStorage.setItem("token", token);
      document.getElementById("loginForm").style.display = "none";
      document.getElementById("mainApp").style.display = "block";
      document.getElementById("userName").innerHTML = `${user.avatar || "👤"} ${
        user.fullName
      } (${user.role})`;
      document.getElementById("profileUsername").innerText = user.username;
      document.getElementById("profileEmail").innerText = user.email || "-";
      document.getElementById("profileFullName").innerText = user.fullName;
      document.getElementById("profileRole").innerText = user.role;

      const profileAvatarDiv = document.getElementById("profileAvatar");
      if (profileAvatarDiv) {
        if (user.avatar && user.avatar.startsWith("/avatars/")) {
          profileAvatarDiv.innerHTML = `<img src="${user.avatar}" style="width:100px; height:100px; border-radius:50%; object-fit:cover;">`;
        } else {
          profileAvatarDiv.innerHTML = `<span style="font-size:60px;">${
            user.avatar || "👤"
          }</span>`;
        }
      }

      if (user.role !== "admin" && user.role !== "manager") {
        document.getElementById("manageMenuItem").style.display = "none";
      }

      if (data.mustChangePassword) {
        setTimeout(() => changePassword(true), 1000);
      }

      connectWebSocket();
      loadFolders();
      loadWhoIsWorking();
      loadShiftHistory();
      loadShiftStatus();
      loadHomeShiftStatus();
      loadStats();
      loadSchedule();
      loadNotifications();
      initCharts();
      showSection("home");

      setInterval(() => {
        loadWhoIsWorking();
        loadStats();
        loadNotifications();
      }, 30000);
    } else {
      alert("Ошибка: " + data.error);
    }
  } catch (err) {
    alert("Ошибка соединения");
  }
}

function doLogout() {
  if (ws) ws.close();
  sessionStorage.removeItem("token");
  location.reload();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function showSection(section) {
  if (
    section === "manage" &&
    user.role !== "admin" &&
    user.role !== "manager"
  ) {
    alert("Доступ запрещен");
    return;
  }

  const sections = [
    "homeSection",
    "shiftsSection",
    "chatsSection",
    "whosworkingSection",
    "timesheetSection",
    "statsSection",
    "scheduleSection",
    "mapSection",
    "profileSection",
    "manageSection",
  ];
  sections.forEach((s) => {
    const el = document.getElementById(s);
    if (el) el.style.display = "none";
  });
  document.getElementById(section + "Section").style.display = "block";

  document
    .querySelectorAll(".sidebar-item")
    .forEach((item) => item.classList.remove("active"));
  event.target.closest(".sidebar-item").classList.add("active");

  if (section === "timesheet") {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("tsStart").value = today;
    document.getElementById("tsEnd").value = today;
    loadTimesheet();
  }
  if (section === "stats") loadStats();
  if (section === "schedule") loadSchedule();
  if (section === "chats") loadFolders();
  if (section === "home") {
    loadHomeShiftStatus();
  }
  if (
    section === "manage" &&
    (user.role === "admin" || user.role === "manager")
  ) {
    loadUsers();
    loadFoldersForSelect();
  }
}

// ========== ЗАГРУЗКА АВАТАРКИ ==========
async function uploadAvatar() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const resp = await fetch("/api/upload-avatar", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData,
      });
      const data = await resp.json();
      if (data.success) {
        showToast("Аватар", "Аватар обновлен");
        const meResp = await fetch("/api/me", {
          headers: { Authorization: "Bearer " + token },
        });
        const meData = await meResp.json();
        if (meData.user) {
          user.avatar = meData.user.avatar_file
            ? `/avatars/${meData.user.avatar_file}`
            : meData.user.avatar || "👤";
          document.getElementById(
            "userName"
          ).innerHTML = `${user.avatar} ${user.fullName} (${user.role})`;

          const profileAvatarDiv = document.getElementById("profileAvatar");
          if (profileAvatarDiv) {
            if (user.avatar && user.avatar.startsWith("/avatars/")) {
              profileAvatarDiv.innerHTML = `<img src="${user.avatar}" style="width:100px; height:100px; border-radius:50%; object-fit:cover;">`;
            } else {
              profileAvatarDiv.innerHTML = `<span style="font-size:60px;">${
                user.avatar || "👤"
              }</span>`;
            }
          }
        }
        location.reload();
      } else {
        alert("Ошибка загрузки аватарки");
      }
    } catch (err) {
      alert("Ошибка загрузки");
    }
  };
  input.click();
}

// ========== ЧАТЫ ==========
async function loadFolders() {
  try {
    const resp = await fetch("/api/folders", {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await resp.json();
    const container = document.getElementById("foldersList");
    let totalUnread = 0;
    if (data.folders && data.folders.length) {
      container.innerHTML = data.folders
        .map((f) => {
          if (f.unread && f.unread > 0) totalUnread += f.unread;
          return `
                    <div class="folder-card" onclick="selectFolder(${
                      f.id
                    }, '${f.name.replace(/'/g, "\\'")}', '${f.icon || "💬"}')">
                        <div class="folder-icon">${f.icon || "💬"}</div>
                        <div class="folder-info">
                            <div class="folder-name">${f.name}</div>
                            <div class="folder-desc">${
                              f.description || "Групповой чат"
                            }</div>
                        </div>
                        ${
                          f.unread && f.unread > 0
                            ? `<div class="folder-unread">${f.unread}</div>`
                            : ""
                        }
                        <div class="favorite-star" onclick="toggleFavorite(${
                          f.id
                        }, ${f.is_favorite || 0}, event)">${
            f.is_favorite ? "⭐" : "☆"
          }</div>
                    </div>
                `;
        })
        .join("");
      const badge = document.getElementById("chatUnreadBadge");
      if (totalUnread > 0) {
        badge.innerText = totalUnread;
        badge.style.display = "inline-block";
      } else badge.style.display = "none";
    } else container.innerHTML = "Нет чатов";
  } catch (err) {
    console.error(err);
  }
}

async function selectFolder(id, name, icon) {
  currentFolder = id;
  document.getElementById("chatTitle").innerHTML = `${icon} ${name}`;
  try {
    const resp = await fetch(`/api/group-messages/${id}`, {
      headers: { Authorization: "Bearer " + token },
    });
    const data = await resp.json();
    const container = document.getElementById("chatMessages");
    if (data.messages && data.messages.length) {
      container.innerHTML = data.messages
        .map((msg) => {
          const isOwn = msg.user_id === user.id;
          const canEdit =
            isOwn && new Date() - new Date(msg.created_at) < 30 * 60000;
          const reactions = msg.reactions || [];
          const reactionMap = {};
          reactions.forEach((r) => {
            reactionMap[r.reaction] = (reactionMap[r.reaction] || 0) + 1;
          });
          let reactionHtml = "";
          for (const [reaction, count] of Object.entries(reactionMap)) {
            reactionHtml += `<span class="reaction-btn" onclick="addReaction(${msg.id}, '${reaction}')">${reaction} ${count}</span>`;
          }
          reactionHtml += `<span class="reaction-btn" onclick="showReactionPicker(${msg.id})">➕</span>`;

          let linkPreview = "";
          const urlMatch = msg.message?.match(/(https?:\/\/[^\s]+)/g);
          if (urlMatch) {
            linkPreview = `<div class="link-preview"><a href="${urlMatch[0]}" target="_blank">🔗 ${urlMatch[0]}</a></div>`;
          }

          const avatarDisplay =
            msg.user_avatar && msg.user_avatar.startsWith("/avatars/")
              ? `<img src="${msg.user_avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;">`
              : msg.user_avatar || "👤";

          const imageHtml =
            msg.file_url && msg.file_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
              ? `<img src="${msg.file_url}" class="message-image" onclick="showImageModal('${msg.file_url}')">`
              : "";

          return `<div class="message ${
            isOwn ? "message-own" : "message-other"
          }" id="msg-${msg.id}">
                    <div class="message-bubble">
                        ${
                          msg.reply_to
                            ? `<div class="reply-indicator" onclick="scrollToMessage(${msg.reply_to})">↩️ Ответ на сообщение</div>`
                            : ""
                        }
                        <div class="message-header">
                            <span class="message-avatar">${avatarDisplay}</span>
                            <span class="message-name">${msg.full_name}</span>
                            <span class="message-time">${new Date(
                              msg.created_at
                            ).toLocaleString()}</span>
                            ${
                              msg.is_edited
                                ? '<span class="message-time">(ред.)</span>'
                                : ""
                            }
                        </div>
                        <div class="message-text">${escapeHtml(
                          msg.message || ""
                        )}</div>
                        ${linkPreview}
                        ${imageHtml}
                        ${
                          msg.is_audio && msg.file_url
                            ? `<audio controls src="${msg.file_url}"></audio>`
                            : ""
                        }
                        <div class="message-reactions">${reactionHtml}</div>
                    </div>
                    <div style="margin-top:5px; font-size:11px">
                        <button class="icon-btn" onclick="copyMessage('${escapeHtml(
                          msg.message || ""
                        ).replace(/'/g, "\\'")}')">📋</button>
                        <button class="icon-btn" onclick="setReplyTo(${
                          msg.id
                        }, '${msg.full_name.replace(/'/g, "\\'")}')">↩️</button>
                        ${
                          canEdit
                            ? `<button class="icon-btn" onclick="editMsg(${msg.id})">✏️</button>`
                            : ""
                        }
                        ${
                          canEdit || user.role === "admin"
                            ? `<button class="icon-btn" onclick="delMsg(${msg.id})">🗑️</button>`
                            : ""
                        }
                    </div>
                </div>`;
        })
        .join("");
    } else
      container.innerHTML =
        '<div style="text-align:center;color:#888">Нет сообщений</div>';
    container.scrollTop = container.scrollHeight;
    markMessagesAsRead(id);
  } catch (err) {
    console.error(err);
  }
}

function showImageModal(imageUrl) {
  const modal = document.getElementById("imageModal");
  const img = document.getElementById("modalImage");
  img.src = imageUrl;
  modal.style.display = "flex";
}

function closeImageModal() {
  document.getElementById("imageModal").style.display = "none";
}

function markMessagesAsRead(folderId) {
  fetch(`/api/mark-read/${folderId}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  }).catch(() => {});
  loadFolders();
}

function copyMessage(text) {
  navigator.clipboard.writeText(text);
  showToast("Скопировано", "📋");
}

function escapeHtml(text) {
  if (!text) return "";
  return text.replace(
    /[&<>]/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])
  );
}

function scrollToMessage(id) {
  document
    .getElementById(`msg-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setReplyTo(id, name) {
  replyToMessage = id;
  document.getElementById("replyingToText").innerText = name;
  document.getElementById("replyBar").style.display = "flex";
}

function cancelReply() {
  replyToMessage = null;
  document.getElementById("replyBar").style.display = "none";
}

async function sendMessage() {
  const message = document.getElementById("messageInput").value;
  if (!message && !currentFolder) {
    alert("Выберите чат и введите сообщение");
    return;
  }
  const body = { folderId: currentFolder, message: message };
  if (replyToMessage) body.replyTo = replyToMessage;
  try {
    const resp = await fetch("/api/group-messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.success) {
      document.getElementById("messageInput").value = "";
      cancelReply();
      selectFolder(currentFolder, "");
    }
  } catch (err) {
    alert("Ошибка отправки");
  }
}

// Горячие клавиши
document.addEventListener("keydown", function (e) {
  if (document.activeElement && document.activeElement.id === "messageInput") {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
  if (e.key === "Escape") {
    cancelReply();
    document.getElementById("emojiPicker").classList.remove("show");
  }
});

async function editMsg(id) {
  const newMsg = prompt("Новое сообщение:");
  if (newMsg) {
    await fetch(`/api/group-messages/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ message: newMsg }),
    });
    selectFolder(currentFolder, "");
  }
}

async function delMsg(id) {
  if (confirm("Удалить сообщение?")) {
    await fetch(`/api/group-messages/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    selectFolder(currentFolder, "");
  }
}

async function addReaction(messageId, reaction) {
  await fetch("/api/message-reaction", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ messageId, reaction }),
  });
  selectFolder(currentFolder, "");
}

function showReactionPicker(messageId) {
  const reactions = ["👍", "❤️", "😂", "😮", "🔥", "🍔", "🥩"];
  const picker = prompt(`Реакция: ${reactions.join(", ")}`);
  if (picker && reactions.includes(picker)) addReaction(messageId, picker);
}

function addEmoji(emoji) {
  const input = document.getElementById("messageInput");
  input.value += emoji;
  input.focus();
  document.getElementById("emojiPicker").classList.remove("show");
}

function toggleEmoji() {
  document.getElementById("emojiPicker").classList.toggle("show");
}

function openCamera() {
  document.getElementById("cameraInput").click();
}

async function sendPhoto(input) {
  const file = input.files[0];
  if (!file || !currentFolder) return;
  const formData = new FormData();
  formData.append("folderId", currentFolder);
  formData.append("file", file);
  formData.append("message", "📷 Фото");

  const resp = await fetch("/api/group-messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: formData,
  });
  const data = await resp.json();
  if (data.success) {
    selectFolder(currentFolder, "");
  }
  input.value = "";
}

function startRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    if (recordingInterval) clearInterval(recordingInterval);
    document.getElementById("recordBtn").innerHTML = "🎤";
    document.getElementById("recordingTimer").innerHTML = "";
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      recordingStartTime = Date.now();

      recordingInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById(
          "recordingTimer"
        ).innerHTML = `🔴 ${minutes}:${seconds.toString().padStart(2, "0")}`;
      }, 1000);

      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        if (recordingInterval) clearInterval(recordingInterval);
        document.getElementById("recordingTimer").innerHTML = "";
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("folderId", currentFolder);
        formData.append("file", audioBlob, "audio.webm");
        formData.append("message", "🎤 Голосовое");
        formData.append("isAudio", "1");

        fetch("/api/group-messages", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
          body: formData,
        }).then(() => selectFolder(currentFolder, ""));

        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start();
      document.getElementById("recordBtn").innerHTML = "⏹️";
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === "recording")
          mediaRecorder.stop();
      }, 60000);
    })
    .catch(() => alert("Нет микрофона"));
}

async function searchInChat() {
  const query = document.getElementById("searchInput").value;
  if (!query) {
    alert("Введите текст");
    return;
  }
  const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const container = document.getElementById("searchResults");
  if (data.results && data.results.length) {
    container.innerHTML = data.results
      .map(
        (r) =>
          `<div class="search-result-item" onclick="selectFolder(${
            r.folder_id
          }, '${r.folder_name}', '💬')">📌 ${
            r.folder_name
          }: ${r.message?.substring(0, 80)}...</div>`
      )
      .join("");
  } else container.innerHTML = "Ничего не найдено";
}

async function toggleFavorite(folderId, currentStatus, event) {
  event.stopPropagation();
  const newStatus = currentStatus === 1 ? 0 : 1;
  await fetch(`/api/folders/favorite/${folderId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ isFavorite: newStatus }),
  });
  loadFolders();
}

// ========== СМЕНЫ ==========
async function clockIn() {
  if (!navigator.geolocation) {
    alert("Геолокация не поддерживается");
    return;
  }

  // Проверяем, нет ли уже активной смены
  try {
    const checkResp = await fetch("/api/active-check", {
      headers: { Authorization: "Bearer " + token },
    });
    const checkData = await checkResp.json();
    if (checkData.hasActiveShift) {
      alert("❌ У вас уже есть активная смена сегодня!");
      return;
    }
  } catch (err) {
    console.error(err);
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const resp = await fetch("/api/clock/in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        showToast("Смена", data.message || "Смена отмечена");
        loadShiftHistory();
        loadWhoIsWorking();
        loadShiftStatus();
        loadHomeShiftStatus();
      } else {
        alert(data.error);
      }
    },
    () => alert("Включите GPS")
  );
}

// ========== ФУНКЦИИ ДЛЯ АДМИНА ==========

async function forceStopShift(entryId, userName) {
  if (confirm(`Принудительно завершить смену сотрудника ${userName}?`)) {
    try {
      const resp = await fetch(`/api/clock/force-stop/${entryId}`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await resp.json();
      if (data.success) {
        showToast("Смена", `Смена ${userName} завершена`);
        loadShiftHistory();
        loadWhoIsWorking();
      } else {
        alert("Ошибка: " + data.error);
      }
    } catch (err) {
      alert("Ошибка: " + err.message);
    }
  }
}

async function deleteShift(id) {
  if (confirm("Удалить смену?")) {
    await fetch(`/api/time-entry/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    loadShiftHistory();
  }
}

async function loadShiftHistory() {
  const today = new Date().toISOString().split("T")[0];
  const resp = await fetch(
    `/api/export-timesheet?startDate=2024-01-01&endDate=${today}`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await resp.json();
  const container = document.getElementById("shiftHistory");
  if (data.data && data.data.length) {
    container.innerHTML = `<table>
            <tr><th>Дата</th><th>Сотрудник</th><th>Приход</th><th>Уход</th><th>Статус</th><th>Опоздание</th>${
              user.role === "admin" ? "<th>⚡ Действие</th>" : ""
            }</tr>
            ${data.data
              .slice(0, 15)
              .map(
                (s) => `<tr>
                <td>${s.date}</td>
                <td>${s.full_name}</td>
                <td>${
                  s.clock_in ? new Date(s.clock_in).toLocaleTimeString() : "-"
                }</td>
                <td>${
                  s.clock_out ? new Date(s.clock_out).toLocaleTimeString() : "-"
                }</td>
                <td>${s.status}</td>
                <td>${s.is_late ? s.late_minutes + " мин" : "-"}</td>
                ${
                  user.role === "admin"
                    ? `<td style="background: rgba(231, 76, 60, 0.2);">
                    <button onclick="forceStopShift(${s.id}, '${s.full_name}')" style="background:#e74c3c; color:white; border:none; padding:8px 15px; border-radius:25px; cursor:pointer; font-size:12px; font-weight:bold; margin-right:8px;">⏹️ Закончить</button>
                    <button onclick="deleteShift(${s.id})" style="background:#555; color:white; border:none; padding:8px 12px; border-radius:25px; cursor:pointer;">🗑️</button>
                 </td>`
                    : ""
                }
            </tr>`
              )
              .join("")}
        </table>`;
  } else container.innerHTML = "Нет данных";
}

async function loadShiftStatus() {
  const today = new Date().toISOString().split("T")[0];
  const resp = await fetch(
    `/api/export-timesheet?startDate=${today}&endDate=${today}`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await resp.json();
  const statusDiv = document.getElementById("shiftStatus");
  const todayShift = data.data?.find((s) => s.user_id === user.id);
  if (todayShift && todayShift.status === "active") {
    statusDiv.innerHTML =
      '<div style="background:#00c853; padding:15px; border-radius:10px; text-align:center;">✅ Смена активна</div>';
  } else if (todayShift && todayShift.status === "pending") {
    statusDiv.innerHTML =
      '<div style="background:#ff9800; padding:15px; border-radius:10px; text-align:center;">⏳ Ожидает подтверждения</div>';
  } else {
    statusDiv.innerHTML =
      '<div style="background:#3a3a5a; padding:15px; border-radius:10px; text-align:center;">Нет активной смены</div>';
  }
}

async function loadHomeShiftStatus() {
  const today = new Date().toISOString().split("T")[0];
  const resp = await fetch(
    `/api/export-timesheet?startDate=${today}&endDate=${today}`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await resp.json();
  const statusDiv = document.getElementById("homeShiftStatus");
  const todayShift = data.data?.find((s) => s.user_id === user.id);
  if (todayShift && todayShift.status === "active") {
    statusDiv.innerHTML = "✅ Вы сейчас на смене!";
    statusDiv.style.background = "#00c853";
    statusDiv.style.color = "white";
    statusDiv.style.padding = "12px";
    statusDiv.style.borderRadius = "30px";
    statusDiv.style.marginTop = "20px";
  } else if (todayShift && todayShift.status === "pending") {
    statusDiv.innerHTML = "⏳ Ваша смена ожидает подтверждения";
    statusDiv.style.background = "#ff9800";
    statusDiv.style.color = "white";
    statusDiv.style.padding = "12px";
    statusDiv.style.borderRadius = "30px";
    statusDiv.style.marginTop = "20px";
  } else {
    statusDiv.innerHTML = "";
  }
}

function showOvertimeModal() {
  document.getElementById("overtimeModal").style.display = "flex";
  document.getElementById("overtimeDate").value = new Date()
    .toISOString()
    .split("T")[0];
}

function closeOvertimeModal() {
  document.getElementById("overtimeModal").style.display = "none";
}

async function submitOvertime() {
  const hours = document.getElementById("overtimeHours").value;
  const date = document.getElementById("overtimeDate").value;
  const reason = document.getElementById("overtimeReason").value;
  if (!hours) {
    alert("Введите часы");
    return;
  }
  const resp = await fetch("/api/overtime-request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ hours: parseFloat(hours), date, reason }),
  });
  const data = await resp.json();
  showToast("Переработка", data.message || "Запрос отправлен");
  closeOvertimeModal();
}

// ========== КТО НА СМЕНЕ ==========
async function loadWhoIsWorking() {
  const resp = await fetch("/api/who-is-working", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const container = document.getElementById("whoIsWorkingList");
  if (data.working && data.working.length) {
    container.innerHTML = data.working
      .map((w) => {
        const avatarDisplay =
          w.user_avatar && w.user_avatar.startsWith("/avatars/")
            ? `<img src="${w.user_avatar}" style="width:48px; height:48px; border-radius:50%; object-fit:cover;">`
            : w.user_avatar || "👤";
        return `
                <div class="worker-card">
                    <div class="worker-avatar">${avatarDisplay}</div>
                    <div class="worker-info">
                        <div class="worker-name">${w.full_name}</div>
                        <div class="worker-role">${w.role || "Сотрудник"}</div>
                        <div class="worker-time"><i class="fas fa-clock"></i> Начало: ${new Date(
                          w.clock_in
                        ).toLocaleTimeString()}</div>
                    </div>
                    <div class="worker-status">
                        <i class="fas fa-circle" style="font-size:10px; margin-right:5px;"></i> На смене
                    </div>
                </div>
            `;
      })
      .join("");
  } else {
    container.innerHTML =
      '<div style="text-align:center;padding:50px; background:rgba(0,0,0,0.2); border-radius:20px;">🎯 Никого нет на смене</div>';
  }
}

// ========== ТАБЕЛЬ ==========
async function loadTimesheet() {
  const start = document.getElementById("tsStart").value;
  const end = document.getElementById("tsEnd").value;
  const resp = await fetch(`/api/timesheet?startDate=${start}&endDate=${end}`, {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const container = document.getElementById("timesheetTable");
  if (data.data && data.data.length) {
    container.innerHTML = `<table>
            <tr><th>Дата</th><th>Сотрудник</th><th>Приход</th><th>Уход</th><th>Статус</th><th>Опоздание</th></tr>
            ${data.data
              .map(
                (s) => `<tr>
                <td>${s.date}</td>
                <td>${s.full_name}</td>
                <td>${
                  s.clock_in ? new Date(s.clock_in).toLocaleTimeString() : "-"
                }</td>
                <td>${
                  s.clock_out ? new Date(s.clock_out).toLocaleTimeString() : "-"
                }</td>
                <td>${s.status}</td>
                <td>${s.is_late ? s.late_minutes + " мин" : "-"}</td>
            </tr>`
              )
              .join("")}
        </table>`;
  } else container.innerHTML = "Нет данных";
}

async function exportReportCSV() {
  const start = document.getElementById("tsStart").value;
  const end = document.getElementById("tsEnd").value;
  if (!start || !end) {
    alert("Выберите период");
    return;
  }
  const resp = await fetch(`/api/timesheet?startDate=${start}&endDate=${end}`, {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  if (data.data && data.data.length) {
    let csv = "Дата,Сотрудник,Приход,Уход,Статус,Опоздание\n";
    data.data.forEach((s) => {
      csv += `${s.date},${s.full_name},${s.clock_in || ""},${
        s.clock_out || ""
      },${s.status},${s.is_late ? s.late_minutes : ""}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${start}_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } else alert("Нет данных");
}

// ========== СТАТИСТИКА ==========
async function loadStats() {
  const resp = await fetch("/api/stats", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  if (data.stats) {
    document.getElementById(
      "statsToday"
    ).innerHTML = `📝 Сообщений сегодня: ${data.stats.todayMessages}<br>👥 Смен сегодня: ${data.stats.todayShifts}`;
    document.getElementById(
      "statsActivity"
    ).innerHTML = `👥 Всего сотрудников: ${
      data.stats.weeklyShifts?.length || 0
    }`;
  }
}

function initCharts() {
  const ctx = document.getElementById("weeklyChart")?.getContext("2d");
  if (ctx) {
    weeklyChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: [],
        datasets: [{ label: "Смены", data: [], backgroundColor: "#ff9800" }],
      },
      options: { responsive: true },
    });
    loadStatsForChart();
  }
}

async function loadStatsForChart() {
  const resp = await fetch(
    `/api/timesheet?startDate=2024-01-01&endDate=2026-12-31`,
    { headers: { Authorization: "Bearer " + token } }
  );
  const data = await resp.json();
  if (data.data && weeklyChart) {
    const last7Days = [...new Set(data.data.map((s) => s.date))].slice(-7);
    const counts = last7Days.map(
      (date) => data.data.filter((s) => s.date === date).length
    );
    weeklyChart.data.labels = last7Days;
    weeklyChart.data.datasets[0].data = counts;
    weeklyChart.update();
  }
}

// ========== КАЛЕНДАРЬ ==========
async function loadSchedule() {
  const monthInput = document.getElementById("scheduleMonth");
  if (!monthInput.value)
    monthInput.value = new Date().toISOString().slice(0, 7);
  const [year, month] = monthInput.value.split("-");
  const resp = await fetch(`/api/schedule?month=${month}&year=${year}`, {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const container = document.getElementById("scheduleGrid");
  if (data.schedule && data.schedule.length) {
    container.innerHTML = `<table><th>Дата</th><th>Сотрудник</th><th>Приход</th><th>Уход</th></tr>${data.schedule
      .map(
        (s) => `<tr>
            <td>${s.date}</td>
            <td>${s.full_name}</td>
            <td>${
              s.clock_in ? new Date(s.clock_in).toLocaleTimeString() : "-"
            }</td>
            <td>${
              s.clock_out ? new Date(s.clock_out).toLocaleTimeString() : "-"
            }</td>
        </tr>`
      )
      .join("")}<tr>`;
  } else container.innerHTML = "Нет данных";
}

// ========== УВЕДОМЛЕНИЯ ==========
async function loadNotifications() {
  const resp = await fetch("/api/notifications", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const badge = document.getElementById("notifBadge");
  if (data.notifications && data.notifications.length) {
    badge.innerText = data.notifications.length;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ========== УПРАВЛЕНИЕ ==========
async function createNewFolder() {
  if (user.role !== "admin" && user.role !== "manager") {
    alert("Доступ запрещен");
    return;
  }
  const name = document.getElementById("newFolderName").value;
  const desc = document.getElementById("newFolderDesc").value;
  const roles = document.getElementById("newFolderRoles").value;
  if (!name) {
    alert("Введите название");
    return;
  }
  const resp = await fetch("/api/folders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name, description: desc, allowed_roles: roles }),
  });
  const data = await resp.json();
  if (data.success) {
    alert("Группа создана");
    loadFolders();
    document.getElementById("newFolderName").value = "";
  } else alert("Ошибка");
}

async function addUser() {
  if (user.role !== "admin" && user.role !== "manager") {
    alert("Доступ запрещен");
    return;
  }
  const email = document.getElementById("newUserEmail").value;
  const fullName = document.getElementById("newUserFullName").value;
  const role = document.getElementById("newUserRole").value;
  if (!email || !fullName) {
    alert("Заполните поля");
    return;
  }
  const resp = await fetch("/api/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ email, fullName, role }),
  });
  const data = await resp.json();
  if (data.success) {
    alert(`Сотрудник добавлен. Временный пароль: ${data.tempPassword}`);
    loadUsers();
  } else alert("Ошибка");
}

async function loadUsers() {
  if (user.role !== "admin" && user.role !== "manager") return;
  const resp = await fetch("/api/users", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const container = document.getElementById("usersList");
  if (data.users && data.users.length) {
    container.innerHTML = data.users
      .map((u) => {
        const avatarDisplay = u.avatar_file
          ? `<img src="/avatars/${u.avatar_file}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">`
          : u.avatar || "👤";
        return `
                <div class="worker-card">
                    <div style="font-size:28px;">${avatarDisplay}</div>
                    <div style="flex:1"><strong>${
                      u.full_name
                    }</strong><br><small>${u.email} | ${u.role}</small></div>
                    ${
                      user.role === "admin"
                        ? `<button class="icon-btn" onclick="deleteUser(${u.id})">🗑️</button>`
                        : ""
                    }
                </div>
            `;
      })
      .join("");
  } else container.innerHTML = "Нет пользователей";
}

async function deleteUser(userId) {
  if (user.role !== "admin") {
    alert("Доступ запрещен");
    return;
  }
  if (confirm("Удалить пользователя?")) {
    await fetch(`/api/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });
    loadUsers();
  }
}

async function loadFoldersForSelect() {
  const resp = await fetch("/api/folders", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const select = document.getElementById("addToFolderSelect");
  if (select && data.folders) {
    select.innerHTML = data.folders
      .map((f) => `<option value="${f.id}">${f.name}</option>`)
      .join("");
  }
  loadAllUsersForSelect();
}

async function loadAllUsersForSelect() {
  const resp = await fetch("/api/users", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await resp.json();
  const select = document.getElementById("addUserToFolderSelect");
  if (select && data.users) {
    select.innerHTML = data.users
      .map((u) => `<option value="${u.id}">${u.full_name} (${u.role})</option>`)
      .join("");
  }
}

async function addUserToFolder() {
  const folderId = document.getElementById("addToFolderSelect").value;
  const userId = document.getElementById("addUserToFolderSelect").value;
  if (!folderId || !userId) {
    alert("Выберите чат и сотрудника");
    return;
  }
  const resp = await fetch(`/api/folders/${folderId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ userId }),
  });
  const data = await resp.json();
  if (data.success) {
    alert("Сотрудник добавлен в чат");
  } else alert("Ошибка");
}

// ========== ПРОФИЛЬ ==========
async function changePassword(isFirstLogin = false) {
  let oldPass, newPass;
  if (isFirstLogin) {
    oldPass = prompt("Введите временный пароль:");
    newPass = prompt("Введите новый пароль:");
  } else {
    oldPass = prompt("Текущий пароль:");
    newPass = prompt("Новый пароль:");
  }
  if (oldPass && newPass) {
    const resp = await fetch("/api/change-password", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ currentPassword: oldPass, newPassword: newPass }),
    });
    const data = await resp.json();
    if (data.success) {
      showToast("Пароль", "Пароль изменен");
      if (isFirstLogin) {
        alert("Пароль успешно изменен!");
      }
    } else {
      alert("Ошибка: " + data.error);
    }
  }
}

// ========== WEBSOCKET ==========
function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}?token=${token}`);
  ws.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "typing") {
      document.getElementById("typingIndicator").innerHTML = `✏️ ${
        data.name || "Кто-то"
      } печатает...`;
      setTimeout(
        () => (document.getElementById("typingIndicator").innerHTML = ""),
        3000
      );
    } else {
      if (currentFolder) await selectFolder(currentFolder, "");
      loadFolders();
      loadNotifications();
      showToast("Новое сообщение", "У вас новое сообщение в чате");
    }
  };
}

function showToast(title, message) {
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `<strong>${title}</strong><br>${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== PWA УСТАНОВКА ==========
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.createElement("button");
  installBtn.innerHTML = "📱 Установить приложение";
  installBtn.className = "btn-export";
  installBtn.style.position = "fixed";
  installBtn.style.bottom = "80px";
  installBtn.style.right = "20px";
  installBtn.style.zIndex = "1000";
  installBtn.onclick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        console.log("Пользователь установил PWA");
      }
      deferredPrompt = null;
      installBtn.remove();
    }
  };
  document.body.appendChild(installBtn);
});

// Закрытие модального окна
window.onclick = function (event) {
  const modal = document.getElementById("overtimeModal");
  const imageModal = document.getElementById("imageModal");
  if (event.target === modal) closeOvertimeModal();
  if (event.target === imageModal) closeImageModal();
};

// Закрытие эмодзи-пикера
document.addEventListener("click", function (e) {
  const picker = document.getElementById("emojiPicker");
  const emojiBtn = e.target.closest('[onclick="toggleEmoji()"]');
  if (picker && !picker.contains(e.target) && !emojiBtn) {
    picker.classList.remove("show");
  }
});

// ========== АВТОВХОД ==========
const savedToken = sessionStorage.getItem("token");
if (savedToken) {
  token = savedToken;
  fetch("/api/me", { headers: { Authorization: "Bearer " + token } })
    .then((res) => res.json())
    .then((data) => {
      if (data.user) {
        user = data.user;
        document.getElementById("loginForm").style.display = "none";
        document.getElementById("mainApp").style.display = "block";
        document.getElementById("userName").innerHTML = `${
          user.avatar || "👤"
        } ${user.fullName} (${user.role})`;

        const profileAvatarDiv = document.getElementById("profileAvatar");
        if (profileAvatarDiv) {
          if (user.avatar && user.avatar.startsWith("/avatars/")) {
            profileAvatarDiv.innerHTML = `<img src="${user.avatar}" style="width:100px; height:100px; border-radius:50%; object-fit:cover;">`;
          } else {
            profileAvatarDiv.innerHTML = `<span style="font-size:60px;">${
              user.avatar || "👤"
            }</span>`;
          }
        }

        if (user.role !== "admin" && user.role !== "manager") {
          document.getElementById("manageMenuItem").style.display = "none";
        }

        connectWebSocket();
        loadFolders();
        loadWhoIsWorking();
        loadShiftHistory();
        loadShiftStatus();
        loadHomeShiftStatus();
        loadStats();
        initCharts();
        showSection("home");
        if (user.role === "admin" || user.role === "manager") loadUsers();

        setInterval(() => {
          loadWhoIsWorking();
          loadStats();
          loadNotifications();
        }, 30000);
      } else doLogout();
    })
    .catch(() => doLogout());
}
