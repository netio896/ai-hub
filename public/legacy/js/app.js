/**
 * Omni-AI Hub 核心应用逻辑
 * 基于 Puter.js 驱动
 */

class UIManager {
    static showModal(text) {
        const modal = document.getElementById('modal-overlay');
        document.getElementById('modal-text').innerText = text;
        modal.style.display = 'flex';
    }

    static hideModal() {
        document.getElementById('modal-overlay').style.display = 'none';
    }

    static showAlert(message) {
        alert(message); // Could be replaced with a custom toast notification
    }
}

class DeviceAndPWAModule {
    constructor() {
        this.installBtn = document.getElementById('pwa-install-btn');
        this.deferredPrompt = null;
        this.isStandalone = this.detectStandalone();

        this.applyDeviceState();
        window.addEventListener('resize', () => this.applyDeviceState());
        this.bindInstallPrompt();
        this.registerServiceWorker();
    }

    detectMobile() {
        const ua = navigator.userAgent || '';
        const mobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
        const narrowViewport = window.matchMedia?.('(max-width: 860px)').matches;
        return Boolean(mobileUa || (coarsePointer && narrowViewport));
    }

    detectStandalone() {
        return window.matchMedia?.('(display-mode: standalone)').matches ||
            window.navigator.standalone === true ||
            document.referrer.startsWith('android-app://');
    }

    applyDeviceState() {
        const isMobile = this.detectMobile();
        document.documentElement.classList.toggle('is-mobile-device', isMobile);
        document.documentElement.classList.toggle('is-desktop-device', !isMobile);
        document.documentElement.classList.toggle('is-standalone-app', this.isStandalone);
    }

    bindInstallPrompt() {
        if (!this.installBtn || this.isStandalone) return;

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.deferredPrompt = event;
            this.installBtn.style.display = 'inline-flex';
        });

        window.addEventListener('appinstalled', () => {
            this.deferredPrompt = null;
            this.installBtn.style.display = 'none';
            document.documentElement.classList.add('is-standalone-app');
        });

        this.installBtn.addEventListener('click', () => this.installApp());

        if (this.isIOS()) {
            this.installBtn.style.display = 'inline-flex';
        }
    }

    async installApp() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            await this.deferredPrompt.userChoice;
            this.deferredPrompt = null;
            this.installBtn.style.display = 'none';
            return;
        }

        if (this.isIOS()) {
            UIManager.showAlert('iPhone/iPad: Tap Share, then Add to Home Screen.');
            return;
        }

        UIManager.showAlert('Use your browser menu to install this app.');
    }

    isIOS() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    }

    async registerServiceWorker() {
        if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

        try {
            await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        } catch (error) {
            console.warn('Service worker registration failed', error);
        }
    }
}

class DeployModule {
    constructor() {
        this.deployBtn = document.getElementById('deploy-btn');
        this.statusEl = document.getElementById('deploy-status');
        this.siteFiles = [
            'index.html',
            'css/style.css',
            'js/app.js',
            'manifest.webmanifest',
            'sw.js',
            'offline.html',
            'icons/icon-192.png',
            'icons/icon-512.png',
            'icons/icon.svg'
        ];
        this.defaultSubdomain = this.getDefaultSubdomain();

        if (this.deployBtn) {
            this.deployBtn.addEventListener('click', () => this.deployCurrentSite());
        }

        this.refreshStatusFromStorage();
    }

    getDefaultSubdomain() {
        const saved = localStorage.getItem('omni-ai-hub:last-subdomain');
        if (saved) return saved;
        return 'omni-ai-hub-' + Math.random().toString(36).slice(2, 8);
    }

    refreshStatusFromStorage() {
        const saved = localStorage.getItem('omni-ai-hub:last-subdomain');
        if (saved && this.statusEl) {
            this.statusEl.innerHTML = `<a href="https://${saved}.puter.site" target="_blank" rel="noopener noreferrer">${saved}.puter.site</a>`;
        }
    }

    sanitizeSubdomain(value) {
        return (value || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 63);
    }

    async deployCurrentSite() {
        if (!puter.auth.isSignedIn()) {
            UIManager.showAlert('请先登录 Puter 账户后再发布。');
            return;
        }

        const requested = window.prompt(
            '请输入 Puter 子域名前缀（不含 .puter.site）',
            this.defaultSubdomain
        );
        if (requested === null) return;

        const subdomain = this.sanitizeSubdomain(requested);
        if (!subdomain) {
            UIManager.showAlert('子域名不能为空。');
            return;
        }

        const originalButtonHtml = this.deployBtn.innerHTML;
        this.deployBtn.disabled = true;
        this.deployBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 发布中';
        this.statusEl.textContent = '正在打包并上传...';

        const rootDir = `omni-ai-hub-deployments/${subdomain}`;

        try {
            await puter.fs.mkdir(rootDir, { createMissingParents: true });
            await this.uploadSiteFiles(rootDir);

            let site;
            try {
                site = await puter.hosting.create(subdomain, rootDir);
            } catch (createError) {
                site = await this.tryUpdateExistingSite(subdomain, rootDir, createError);
            }

            localStorage.setItem('omni-ai-hub:last-subdomain', subdomain);
            this.defaultSubdomain = subdomain;
            this.statusEl.innerHTML = `<a href="https://${site.subdomain}.puter.site" target="_blank" rel="noopener noreferrer">${site.subdomain}.puter.site</a>`;
            UIManager.showAlert(`发布完成: https://${site.subdomain}.puter.site`);
        } catch (error) {
            console.error('Deploy failed', error);
            this.statusEl.textContent = `发布失败: ${error.message}`;
            UIManager.showAlert(`发布失败: ${error.message}`);
        } finally {
            this.deployBtn.disabled = false;
            this.deployBtn.innerHTML = originalButtonHtml;
        }
    }

    async uploadSiteFiles(rootDir) {
        for (const relativePath of this.siteFiles) {
            const fileText = await this.fetchLocalFile(relativePath);
            await this.ensureParentDirectory(`${rootDir}/${relativePath}`);
            await puter.fs.write(`${rootDir}/${relativePath}`, fileText);
        }
    }

    async ensureParentDirectory(filePath) {
        const lastSlashIndex = filePath.lastIndexOf('/');
        if (lastSlashIndex <= 0) return;

        const parentDir = filePath.slice(0, lastSlashIndex);
        await puter.fs.mkdir(parentDir, { createMissingParents: true });
    }

    async fetchLocalFile(relativePath) {
        const response = await fetch(relativePath, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`无法读取本地文件: ${relativePath}`);
        }
        return await response.text();
    }

    async tryUpdateExistingSite(subdomain, rootDir, createError) {
        try {
            await puter.hosting.get(subdomain);
            return await puter.hosting.update(subdomain, rootDir);
        } catch (lookupError) {
            throw createError;
        }
    }
}

class AuthManager {
    constructor() {
        this.loginBtn = document.getElementById('login-btn');
        this.logoutBtn = document.getElementById('logout-btn');
        this.userInfo = document.getElementById('user-info');
        this.userName = document.getElementById('user-name');
        
        this.init();
    }

    async init() {
        this.loginBtn.addEventListener('click', () => this.signIn());
        this.logoutBtn.addEventListener('click', () => this.signOut());
        await this.checkAuthStatus();
    }

    async checkAuthStatus() {
        const isSignedIn = puter.auth.isSignedIn();
        if (isSignedIn) {
            this.loginBtn.style.display = 'none';
            this.userInfo.style.display = 'flex';
            try {
                const user = await puter.auth.getUser();
                this.userName.innerText = user.username;
                document.getElementById('user-avatar').src = 'https://ui-avatars.com/api/?name=' + user.username + '&background=8b5cf6&color=fff';
                
                // 获取用户算力额度
                try {
                    const usage = await puter.auth.getMonthlyUsage();
                    const quotaEl = document.getElementById('user-quota');
                    if (usage && usage.plan) {
                        const remaining = usage.plan.credits - usage.credits;
                        quotaEl.innerHTML = `<i class="fa-solid fa-bolt"></i> 剩余算力: $${remaining.toFixed(2)}`;
                    } else {
                        quotaEl.innerHTML = `<i class="fa-solid fa-bolt"></i> 免费开发者节点`;
                    }
                } catch (e) {
                    document.getElementById('user-quota').innerHTML = `<i class="fa-solid fa-bolt"></i> 免费开发者节点`;
                }
                
                // 如果已登录，则触发云端笔记同步
                window.app.notesModule.loadNotes();
            } catch (e) {
                console.error("Failed to fetch user data", e);
            }
        } else {
            this.loginBtn.style.display = 'block';
            this.userInfo.style.display = 'none';
        }
    }

    async signIn() {
        try {
            await puter.auth.signIn();
            await this.checkAuthStatus();
        } catch (e) {
            UIManager.showAlert("登录失败或被取消。");
        }
    }

    async signOut() {
        try {
            await puter.auth.signOut();
            window.location.reload();
        } catch (e) {
            UIManager.showAlert("退出失败。");
        }
    }
}

class ChatModule {
    constructor() {
        this.modeCards = document.querySelectorAll('.mode-card');
        this.modelSelect = document.getElementById('chat-model-select');
        this.chatInput = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('chat-send-btn');
        this.display = document.getElementById('chat-display');
        
        this.isProcessing = false;
        
        // 根据能力特性将模式映射到对应的 Puter 原生模型
        this.modelsMap = {
            'free': [
                { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (日常神机/免费)' },
                { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (轻量开源/免费)' },
                { id: 'x-ai/grok-4.20', name: 'Grok 4.20 (极简对话/免费)' },
                { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (极速阅读/免费)' }
            ]
        };

        this.currentFile = null;
        this.conversationHistory = []; // 跨消息追踪上下文

        this.attachBtn = document.getElementById('chat-attach-btn');
        this.fileInput = document.getElementById('chat-file-input');
        this.attachPreview = document.getElementById('chat-attachment-preview');
        this.imgPreview = document.getElementById('chat-image-preview');
        this.removeAttachBtn = document.getElementById('chat-remove-attachment');
        this.clearBtn = document.getElementById('chat-clear-btn');

        this.initModeSelector();
        this.initAttachment();
        
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.clearBtn.addEventListener('click', () => this.clearChat());
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
    }

    clearChat() {
        if (this.isProcessing) return;
        this.conversationHistory = [];
        this.display.innerHTML = '<div class="message ai">上下文已被清空。当前保持在免费专区，您可以继续使用上方可用的免费模型。</div>';
        this.currentFile = null;
        this.fileInput.value = '';
        this.attachPreview.style.display = 'none';
        this.chatInput.focus();
    }

    initModeSelector() {
        this.modeCards.forEach(card => {
            card.addEventListener('click', () => {
                this.modeCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.updateModelDropdown(card.dataset.mode);
            });
        });
        // 初始化默认模式
        this.updateModelDropdown('free');
    }

    initAttachment() {
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.currentFile = file;
                this.imgPreview.src = URL.createObjectURL(file);
                this.attachPreview.style.display = 'flex';
            }
        });
        this.removeAttachBtn.addEventListener('click', () => {
            this.currentFile = null;
            this.fileInput.value = '';
            this.attachPreview.style.display = 'none';
        });
    }

    updateModelDropdown(mode) {
        this.modelSelect.innerHTML = '';
        const models = this.modelsMap[mode] || this.modelsMap['free'];
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.innerText = m.name;
            this.modelSelect.appendChild(opt);
        });
    }

    appendMessage(role, text) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.innerText = text;
        
        // 为 AI 的回复添加朗读按钮
        if (role === 'ai') {
            const ttsBtn = document.createElement('button');
            ttsBtn.className = 'read-aloud-btn';
            ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            ttsBtn.title = '朗读此段';
            ttsBtn.onclick = async () => {
                ttsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                ttsBtn.disabled = true;
                
                const src = await window.app.voiceModule.getAudioSrc(text);
                if (src) {
                    ttsBtn.style.display = 'none';
                    const audioPlayer = document.createElement('audio');
                    audioPlayer.controls = true;
                    audioPlayer.src = src;
                    audioPlayer.style.width = '100%';
                    audioPlayer.style.marginTop = '12px';
                    audioPlayer.style.borderRadius = '8px';
                    audioPlayer.play();
                    div.appendChild(audioPlayer);
                    this.scrollToBottom();
                } else {
                    ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
                    ttsBtn.disabled = false;
                }
            };
            div.appendChild(ttsBtn);
        }
        
        this.display.appendChild(div);
        this.scrollToBottom();
        return div;
    }

    scrollToBottom() {
        this.display.scrollTop = this.display.scrollHeight;
    }

    async sendMessage() {
        if (this.isProcessing) return;
        const text = this.chatInput.value.trim();
        if (!text) return;

        this.chatInput.value = '';
        this.isProcessing = true;
        this.sendBtn.disabled = true;

        this.appendMessage('user', text);
        
        const aiBubble = this.appendMessage('ai', '');
        const indicator = document.createElement('span');
        indicator.className = 'typing-indicator';
        aiBubble.appendChild(indicator);

        let systemPrompt = `你是一个全能的 AI 助手。为了防止你的时间认知停留在训练集，这里告诉你现在的真实系统时间：${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} ${new Date().toLocaleTimeString('zh-CN')}。`;
        
        const activeMode = document.querySelector('.mode-card.active').dataset.mode;
        
        // 根据当前模式提供视觉反馈
        if (activeMode === 'search') {
            aiBubble.innerHTML = '<i class="fa-solid fa-globe fa-spin" style="margin-right:8px; color:var(--accent-color);"></i> [正在进行全网实时检索...] <br><br>';
            systemPrompt += " 您现在具备极强的实时联网能力。请确保您的回答包含最新的事实和新闻。";
        } else if (activeMode === 'reasoning') {
            aiBubble.innerHTML = '<i class="fa-solid fa-brain fa-pulse" style="margin-right:8px; color:var(--accent-color);"></i> [深度思考中...] <br><br>';
        } else if (activeMode === 'free') {
            aiBubble.innerHTML = '<i class="fa-solid fa-gift fa-bounce" style="margin-right:8px; color:var(--success);"></i> [免费计算节点已接入] <br><br>';
        }

        // 处理附件上传
        const messages = [
            { role: "system", content: systemPrompt },
            ...this.conversationHistory // 注入完整的上下文记忆
        ];

        let userContent = [];
        userContent.push({ type: "text", text: text });

        if (this.currentFile) {
            try {
                const base64 = await this.fileToBase64(this.currentFile);
                userContent.push({ type: "image_url", image_url: { url: base64 } });
            } catch (e) {
                console.error("Image read failed", e);
            }
            // 读取完毕后清除附件 UI
            this.removeAttachBtn.click();
        }

        // 将用户新消息添加到当前请求中
        messages.push({ role: "user", content: userContent });
        
        // 将纯文本存入历史记录 (不保存 base64 图片以节省 token 和带宽)
        this.conversationHistory.push({ role: "user", content: text });

        try {
            const chatResponse = await puter.ai.chat(messages, { 
                model: this.modelSelect.value,
                stream: true 
            });

            let fullText = "";
            aiBubble.innerHTML = ''; // 清除加载动画

            if (typeof chatResponse[Symbol.asyncIterator] === 'function') {
                for await (const part of chatResponse) {
                    const chunk = part?.text || part?.message?.content || '';
                    if (chunk) {
                        fullText += chunk;
                        // 在流式输出过程中使用 marked 解析 (代码块可能会略显杂乱，但体验优于纯文本)
                        aiBubble.innerHTML = marked.parse(fullText);
                        this.scrollToBottom();
                    }
                }
            } else {
                fullText = chatResponse?.message?.content || chatResponse?.text || JSON.stringify(chatResponse);
                aiBubble.innerHTML = marked.parse(fullText);
            }
            
            // 保存 AI 的回复到历史记录
            this.conversationHistory.push({ role: "assistant", content: fullText });
            
            // 最终渲染: 应用 Markdown 样式、代码高亮和复制按钮
            aiBubble.classList.add('markdown-body');
            aiBubble.innerHTML = marked.parse(fullText);
            
            aiBubble.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
                
                const pre = block.parentElement;
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-code-btn';
                copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制';
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(block.innerText);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i> 已复制';
                    setTimeout(() => copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> 复制', 2000);
                };
                pre.appendChild(copyBtn);
            });
            
            // 在底部重新添加朗读按钮
            const ttsBtn = document.createElement('button');
            ttsBtn.className = 'read-aloud-btn';
            ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            ttsBtn.title = '朗读此段 (生成后可下载)';
            ttsBtn.onclick = async () => {
                // 加载时禁用按钮
                ttsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                ttsBtn.disabled = true;
                
                const src = await window.app.voiceModule.getAudioSrc(fullText);
                if (src) {
                    // 生成后隐藏朗读按钮
                    ttsBtn.style.display = 'none';
                    
                    // 创建内联音频播放器
                    const audioPlayer = document.createElement('audio');
                    audioPlayer.controls = true;
                    audioPlayer.src = src;
                    audioPlayer.style.width = '100%';
                    audioPlayer.style.marginTop = '12px';
                    audioPlayer.style.borderRadius = '8px';
                    audioPlayer.play();
                    
                    aiBubble.appendChild(audioPlayer);
                    this.scrollToBottom();
                } else {
                    // 失败时恢复按钮
                    ttsBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
                    ttsBtn.disabled = false;
                }
            };
            aiBubble.appendChild(ttsBtn);

        } catch (e) {
            aiBubble.innerHTML = `<span style="color:var(--danger)"><i class="fa-solid fa-circle-exclamation"></i> 生成失败: ${e.message}</span>`;
        } finally {
            this.isProcessing = false;
            this.sendBtn.disabled = false;
            this.chatInput.focus();
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }
}

class ImageModule {
    constructor() {
        this.modelSelect = document.getElementById('img-model-select');
        this.promptInput = document.getElementById('img-prompt');
        this.generateBtn = document.getElementById('generate-img-btn');
        this.magicBtn = document.getElementById('magic-prompt-btn');
        this.resultContainer = document.getElementById('img-result-container');
        this.placeholder = document.getElementById('gallery-placeholder');
        this.imgResult = document.getElementById('img-result');
        this.statusText = document.getElementById('img-status');
        
        this.saveCloudBtn = document.getElementById('save-cloud-btn');
        this.downloadBtn = document.getElementById('download-img-btn');
        
        this.currentBlob = null;

        this.generateBtn.addEventListener('click', () => this.generateImage());
        this.magicBtn.addEventListener('click', () => this.magicPrompt());
        this.saveCloudBtn.addEventListener('click', () => this.saveToCloud());
    }

    async magicPrompt() {
        const base = this.promptInput.value.trim() || "一幅美丽的风景画";
        UIManager.showModal("正在用 AI 脑暴神级提示词...");
        try {
            const res = await puter.ai.chat(
                `你是一个 Midjourney 提示词专家。请把以下短句扩写为极具画面感、光影丰富、充满细节的英文提示词（只需返回纯英文提示词，不要解释）：\n${base}`,
                { model: 'openai/gpt-4o' } // 强制使用返回稳定字符串结果的模型
            );
            
            let resultText = "";
            if (typeof res === 'string') {
                resultText = res;
            } else if (res?.message?.content) {
                if (Array.isArray(res.message.content)) {
                    // 处理 Anthropic 风格的数组片段
                    resultText = res.message.content.map(c => c.text || '').join('');
                } else {
                    resultText = res.message.content;
                }
            } else if (res?.text) {
                resultText = res.text;
            } else {
                resultText = JSON.stringify(res);
            }
            
            this.promptInput.value = resultText;
        } catch(e) {
            UIManager.showAlert("扩写失败: " + e.message);
        } finally {
            UIManager.hideModal();
        }
    }

    async generateImage() {
        const prompt = this.promptInput.value.trim();
        if (!prompt) {
            UIManager.showAlert("请输入画面描述！");
            return;
        }

        const model = this.modelSelect.value;
        const ratio = document.querySelector('input[name="aspect-ratio"]:checked').value;

        this.generateBtn.disabled = true;
        this.placeholder.style.display = 'block';
        this.resultContainer.style.display = 'none';
        this.placeholder.innerHTML = '<i class="fa-solid fa-palette fa-bounce"></i><p>云端画师正在创作中，请稍候...</p>';

        try {
            const imageElement = await puter.ai.txt2img(prompt, {
                model: model,
                aspect_ratio: ratio
            });
            
            // 在 UI 上渲染
            this.imgResult.src = imageElement.src;
            
            // 1. 绝对可靠的后备方案：立即设置标准 webp。
            // 这可以防止用户点击过快导致下载"空/损坏的 PNG"文件。
            this.downloadBtn.href = imageElement.src;
            this.downloadBtn.download = `omni-ai-image-${Date.now()}.webp`;
            
            // 2. 尝试同步升级为高质量 PNG
            try {
                const canvas = document.createElement('canvas');
                canvas.width = imageElement.naturalWidth || imageElement.width || 1024;
                canvas.height = imageElement.naturalHeight || imageElement.height || 1024;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imageElement, 0, 0);
                
                // 如果遭遇 CORS 跨域限制，这里会抛出 SecurityError
                const pngDataUrl = canvas.toDataURL('image/png');
                this.downloadBtn.href = pngDataUrl;
                this.downloadBtn.download = `omni-ai-image-${Date.now()}.png`;
                
                // 准备用于保存到云端的 blob 数据
                canvas.toBlob((blob) => {
                    this.currentBlob = blob;
                }, 'image/png');
            } catch(e) {
                console.warn("Canvas export tainted. Keeping original format.", e);
                this.currentBlob = null;
                // 尽管被标记为 taint，仍尝试获取 blob 以保存到云端
                fetch(imageElement.src).then(res => res.blob()).then(b => this.currentBlob = b).catch(err => console.log("Blob fetch failed"));
            }
            
            this.placeholder.style.display = 'none';
            this.resultContainer.style.display = 'flex';

        } catch (e) {
            this.placeholder.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i><p style="color:var(--danger)">生成失败: ${e.message}</p>`;
        } finally {
            this.generateBtn.disabled = false;
        }
    }

    async fallbackDownload(src) {
        try {
            const res = await fetch(src);
            const blob = await res.blob();
            this.currentBlob = blob;
            if (this.currentDownloadUrl) URL.revokeObjectURL(this.currentDownloadUrl);
            this.currentDownloadUrl = URL.createObjectURL(blob);
            this.downloadBtn.href = this.currentDownloadUrl;
            
            // 确定文件扩展名
            const ext = blob.type === 'image/webp' ? 'webp' : (blob.type === 'image/jpeg' ? 'jpg' : 'png');
            this.downloadBtn.download = `omni-image-${Date.now()}.${ext}`;
        } catch(e) {
            // 最终后备方案
            this.downloadBtn.href = src;
            this.downloadBtn.download = `omni-image-${Date.now()}.webp`;
        }
    }

    async saveToCloud() {
        if (!puter.auth.isSignedIn()) {
            UIManager.showAlert("请先点击右上角登录 Puter 账户！");
            return;
        }
        if (!this.currentBlob) return;

        const filename = `omni-ai-img-${Date.now()}.png`;
        const btnOriginal = this.saveCloudBtn.innerHTML;
        this.saveCloudBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';
        
        try {
            const file = new File([this.currentBlob], filename, { type: 'image/png' });
            await puter.fs.write(filename, file);
            this.saveCloudBtn.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i> 已保存';
            setTimeout(() => { this.saveCloudBtn.innerHTML = btnOriginal; }, 3000);
        } catch(e) {
            UIManager.showAlert("保存失败: " + e.message);
            this.saveCloudBtn.innerHTML = btnOriginal;
        }
    }
}

class VoiceModule {
    constructor() {
        // 语音合成 (TTS)
        this.ttsVoice = document.getElementById('tts-voice-select');
        this.ttsEmotion = document.getElementById('tts-emotion-select');
        this.ttsInput = document.getElementById('tts-input');
        this.ttsBtn = document.getElementById('tts-generate-btn');
        this.ttsMagicBtn = document.getElementById('tts-magic-btn');
        this.ttsPlayer = document.getElementById('tts-player');
        this.ttsDownloadBtn = document.getElementById('tts-download-btn');
        this.ttsStatus = document.getElementById('tts-status');
        
        // 语音识别 (STT)
        this.micBtn = document.getElementById('mic-btn');
        this.sttStatus = document.getElementById('stt-status');
        this.sttDuration = document.getElementById('stt-duration');
        this.sttFormat = document.getElementById('stt-format');
        this.sttResult = document.getElementById('stt-result-text');
        this.sttSummarizeBtn = document.getElementById('stt-summarize-btn');
        this.sttSummaryArea = document.getElementById('stt-summary-area');
        this.sttSummaryText = document.getElementById('stt-summary-text');

        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.isTranscribing = false;
        this.recordingMimeType = '';
        this.recordingStartedAt = 0;
        this.recordingTimer = null;
        this.lastTranscript = '';

        this.initTTS();
        this.initSTT();
    }

    initTTS() {
        if (this.ttsMagicBtn) {
            this.ttsMagicBtn.addEventListener('click', async () => {
                const text = this.ttsInput.value.trim();
                if (!text) {
                    UIManager.showAlert("请先输入要分析的原始文本！");
                    return;
                }
                UIManager.showModal("AI 正在分析语境注入情感标签...");
                try {
                    const prompt = `你是一个顶级的声音导演。请为以下台词加入情感控制标签。XAI的语音系统支持且不限于 [laugh], [sigh], [pause], <whisper>...</whisper>, <emphasis>...</emphasis> 等标签。请根据语境在合适的地方插入这些标签，让朗读听起来最具表现力和人情味。只输出处理完成后的最终文本，不要输出任何额外的解释语：\n\n"${text}"`;
                    const res = await puter.ai.chat(prompt, { model: 'openai/gpt-4o' });
                    let resultText = "";
                    if (typeof res === 'string') resultText = res;
                    else resultText = res?.message?.content || res?.text || JSON.stringify(res);
                    
                    resultText = resultText.replace(/^"|"$/g, '');
                    this.ttsInput.value = resultText;
                    this.ttsStatus.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" style="color:var(--accent-color)"></i> 情感标签注入成功！';
                } catch(e) {
                    UIManager.showAlert("分析失败：" + e.message);
                } finally {
                    UIManager.hideModal();
                }
            });
        }

        this.ttsEmotion.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            const text = this.ttsInput.value;
            const start = this.ttsInput.selectionStart;
            this.ttsInput.value = text.slice(0, start) + val + text.slice(start);
            e.target.selectedIndex = 0;
            this.ttsInput.focus();
        });

        this.ttsBtn.addEventListener('click', async () => {
            const text = this.ttsInput.value.trim();
            if (!text) return;
            
            this.ttsStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在合成...';
            const src = await this.getAudioSrc(text, this.ttsVoice.value);
            if (src) {
                this.ttsPlayer.src = src;
                this.ttsPlayer.style.display = 'block';
                this.ttsDownloadBtn.style.display = 'inline-flex';
                this.ttsDownloadBtn.href = src;
                this.ttsDownloadBtn.download = `omni-voice-${Date.now()}.mp3`;
                this.ttsPlayer.play();
                this.ttsStatus.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i> 生成完成';
            } else {
                this.ttsStatus.innerText = '生成失败';
            }
        });
    }

    async getAudioSrc(text, voice = 'eve') {
        UIManager.showModal("正在合成情感语音...");
        try {
            const audioResponse = await puter.ai.txt2speech(text, { provider: 'xai', voice: voice });
            return audioResponse.src;
        } catch(e) {
            UIManager.showAlert("语音合成失败: " + e.message);
            return null;
        } finally {
            UIManager.hideModal();
        }
    }

    initSTT() {
        this.micBtn.addEventListener('click', () => {
            if (this.isTranscribing) return;

            if (this.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        });

        this.sttSummarizeBtn.addEventListener('click', () => this.summarizeTranscript());
    }

    resetSTTOutput() {
        this.lastTranscript = '';
        this.sttResult.innerText = '录音结束后会自动进行大模型听写...';
        this.sttSummarizeBtn.style.display = 'none';
        this.sttSummarizeBtn.disabled = true;
        this.sttSummarizeBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI 一键总结';
        this.sttSummaryArea.style.display = 'none';
        this.sttSummaryText.innerHTML = '';
    }

    getPreferredAudioMimeType() {
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';

        return [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/ogg;codecs=opus',
            'audio/wav'
        ].find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    getAudioExtension(mimeType = '') {
        if (mimeType.includes('mp4')) return 'm4a';
        if (mimeType.includes('ogg')) return 'ogg';
        if (mimeType.includes('wav')) return 'wav';
        if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
        return 'webm';
    }

    startRecordingTimer() {
        this.recordingStartedAt = Date.now();
        this.updateRecordingDuration();
        this.recordingTimer = setInterval(() => this.updateRecordingDuration(), 500);
    }

    stopRecordingTimer() {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
    }

    updateRecordingDuration() {
        const totalSeconds = Math.floor((Date.now() - this.recordingStartedAt) / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        this.sttDuration.innerText = `${minutes}:${seconds}`;
    }

    cleanupRecordingStream() {
        this.mediaRecorder?.stream?.getTracks().forEach(track => track.stop());
    }

    async startRecording() {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            UIManager.showAlert("当前浏览器不支持系统录音，请使用新版 Chrome / Edge，并在 localhost 或 HTTPS 下运行。");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            const preferredMimeType = this.getPreferredAudioMimeType();
            const recorderOptions = preferredMimeType ? { mimeType: preferredMimeType } : undefined;

            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
            this.recordingMimeType = this.mediaRecorder.mimeType || preferredMimeType || 'audio/webm';
            this.audioChunks = [];
            this.resetSTTOutput();

            this.mediaRecorder.ondataavailable = event => {
                if (event.data?.size) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = async () => {
                const mimeType = this.recordingMimeType || this.mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                this.audioChunks = [];
                await this.transcribeAudio(audioBlob, mimeType);
            };

            this.mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error", event.error || event);
                this.stopRecordingTimer();
                this.cleanupRecordingStream();
                this.isRecording = false;
                this.micBtn.classList.remove('recording');
                this.micBtn.disabled = false;
                this.micBtn.setAttribute('aria-label', '开始或结束录音');
                this.sttStatus.innerText = "录音异常，请重新开始。";
            };

            this.mediaRecorder.start(1000);
            this.isRecording = true;
            this.micBtn.classList.add('recording');
            this.micBtn.title = "结束录音";
            this.micBtn.setAttribute('aria-label', '结束录音');
            this.sttStatus.innerText = "录音中... 再次点击麦克风结束";
            this.sttFormat.innerText = this.getAudioExtension(this.recordingMimeType).toUpperCase();
            this.startRecordingTimer();
        } catch (e) {
            UIManager.showAlert("无法获取麦克风权限！请确保网页在 localhost 或 HTTPS 下运行，并允许浏览器使用麦克风。");
        }
    }

    stopRecording() {
        if (!this.mediaRecorder || !this.isRecording) return;

        this.isRecording = false;
        this.stopRecordingTimer();
        this.micBtn.classList.remove('recording');
        this.micBtn.disabled = true;
        this.micBtn.title = "正在转写";
        this.micBtn.setAttribute('aria-label', '正在转写录音');
        this.sttStatus.innerText = "录音已结束，正在整理音频...";

        try {
            if (this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
        } catch (e) {
            this.sttStatus.innerText = "结束录音失败: " + e.message;
            this.micBtn.disabled = false;
            this.micBtn.setAttribute('aria-label', '开始或结束录音');
        } finally {
            this.cleanupRecordingStream();
        }
    }

    async transcribeAudio(blob, mimeType = '') {
        if (!blob.size) {
            this.sttStatus.innerText = "没有捕获到有效音频，请重新录制。";
            this.micBtn.disabled = false;
            this.micBtn.title = "开始录音";
            this.micBtn.setAttribute('aria-label', '开始或结束录音');
            return;
        }

        this.isTranscribing = true;
        this.micBtn.disabled = true;
        this.sttSummarizeBtn.disabled = true;
        UIManager.showModal("正在通过 Puter.js 调用 xAI STT 大模型听写...");

        try {
            const type = mimeType || blob.type || 'audio/webm';
            const extension = this.getAudioExtension(type);
            const file = new File([blob], `omni-recording-${Date.now()}.${extension}`, { type });
            const transcript = await this.callSpeechToText(file);
            const text = this.extractTranscriptText(transcript).trim();

            if (!text) {
                throw new Error("未识别到有效文字，请靠近麦克风或延长录音时间。");
            }

            this.lastTranscript = text;
            this.sttResult.innerText = text;
            this.sttSummarizeBtn.style.display = 'inline-flex';
            this.sttSummarizeBtn.disabled = false;
            this.sttStatus.innerText = `转写完成 · ${(blob.size / 1024).toFixed(1)} KB`;
        } catch (e) {
            this.sttStatus.innerText = "转写失败: " + e.message;
            this.sttResult.innerText = "暂无转写内容";
            UIManager.showAlert("转写失败: " + e.message);
        } finally {
            this.isTranscribing = false;
            this.micBtn.disabled = false;
            this.micBtn.title = "开始录音";
            this.micBtn.setAttribute('aria-label', '开始或结束录音');
            UIManager.hideModal();
        }
    }

    async callSpeechToText(file) {
        const options = {
            provider: "xai",
            language: "zh",
            format: true
        };

        try {
            return await puter.ai.speech2txt(file, options);
        } catch (firstError) {
            console.warn("speech2txt(file, options) failed; retrying with object payload.", firstError);
            return await puter.ai.speech2txt({ file, ...options });
        }
    }

    extractTranscriptText(transcript) {
        if (typeof transcript === 'string') return transcript;
        if (transcript?.text) return transcript.text;
        if (transcript?.transcript) return transcript.transcript;
        if (Array.isArray(transcript?.segments)) {
            return transcript.segments.map(segment => segment.text || '').join('\n');
        }
        if (Array.isArray(transcript?.words)) {
            return transcript.words.map(word => word.text || word.word || '').join(' ');
        }
        return this.extractAIText(transcript);
    }

    extractAIText(res) {
        if (typeof res === 'string') return res;
        const content = res?.message?.content || res?.content;

        if (Array.isArray(content)) {
            return content.map(item => item.text || item.content || '').join('');
        }

        return content || res?.text || JSON.stringify(res);
    }

    chunkText(text, chunkSize = 8000) {
        const chunks = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.slice(i, i + chunkSize));
        }
        return chunks;
    }

    async chatWithFallback(prompt, options = { model: 'openai/gpt-4o-mini' }) {
        try {
            return await puter.ai.chat(prompt, options);
        } catch (firstError) {
            console.warn("Preferred summary model failed; retrying with Puter default model.", firstError);
            return await puter.ai.chat(prompt);
        }
    }

    async summarizeTranscript() {
        const text = (this.lastTranscript || this.sttResult.innerText).trim();
        if (!text || text === '暂无转写内容') {
            UIManager.showAlert("请先完成一次录音转写，再进行总结。");
            return;
        }

        this.sttSummarizeBtn.disabled = true;
        this.sttSummarizeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 总结中...';
        this.sttSummaryArea.style.display = 'block';
        this.sttSummaryText.innerText = '正在提炼会议重点...';
        UIManager.showModal("AI 正在提炼会议重点...");

        try {
            const chunks = this.chunkText(text);
            let summarySource = text;

            if (chunks.length > 1) {
                const partialSummaries = [];

                for (let index = 0; index < chunks.length; index++) {
                    UIManager.showModal(`长转写稿处理中：正在压缩第 ${index + 1}/${chunks.length} 段...`);
                    const partialPrompt = `请把下面这段会议口语转写压缩成后续总结可用的事实笔记。保留结论、争议点、数字、时间、人名、待办事项，不要编造：\n\n${chunks[index]}`;
                    const partialRes = await this.chatWithFallback(partialPrompt);
                    partialSummaries.push(this.extractAIText(partialRes).trim());
                }

                summarySource = partialSummaries.join('\n\n');
                UIManager.showModal("AI 正在合并会议重点...");
            }

            const prompt = `你是专业会议纪要助手。请从以下口语化转写稿中提炼最核心的会议重点，使用简洁中文输出。

要求：
1. 只基于转写稿，不要补充不存在的信息。
2. 优先整理决策、关键结论、重要数据、待办事项、负责人、时间点和风险。
3. 如果没有明确行动项，请写“无明确行动项”。
4. 使用 Markdown，结构包含：核心结论、待办事项、风险与待确认。

转写稿：
${summarySource}`;

            const res = await this.chatWithFallback(prompt);
            const summary = this.extractAIText(res).trim();
            this.sttSummaryText.innerHTML = marked.parse(summary);
            this.sttStatus.innerText = "会议重点已生成";
        } catch (e) {
            this.sttSummaryText.innerText = "总结失败: " + e.message;
            UIManager.showAlert("总结失败: " + e.message);
        } finally {
            this.sttSummarizeBtn.disabled = false;
            this.sttSummarizeBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> AI 一键总结';
            UIManager.hideModal();
        }
    }
}

class NotesModule {
    constructor() {
        this.textarea = document.getElementById('notes-textarea');
        this.saveBtn = document.getElementById('notes-save-btn');
        this.downloadBtn = document.getElementById('notes-download-btn');
        this.statusText = document.getElementById('notes-status-text');
        this.typingTimer = null;

        this.saveBtn.addEventListener('click', () => this.saveNotes());
        this.downloadBtn.addEventListener('click', () => this.downloadNotes());
        
        // 停止输入时自动保存
        this.textarea.addEventListener('keyup', () => {
            clearTimeout(this.typingTimer);
            this.statusText.innerText = '正在编辑...';
            this.typingTimer = setTimeout(() => this.saveNotes(), 2000);
        });
    }

    async loadNotes() {
        if (!puter.auth.isSignedIn()) {
            this.statusText.innerText = '请先登录以同步云端笔记';
            return;
        }
        
        this.statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在从云端拉取数据...';
        try {
            const data = await puter.kv.get('omni_ai_notes');
            if (data) {
                this.textarea.value = data;
            }
            this.statusText.innerHTML = '<i class="fa-solid fa-check" style="color:var(--success)"></i> 云端同步完成';
            // 3 秒后淡出成功提示
            setTimeout(() => this.statusText.innerText = '就绪', 3000);
        } catch(e) {
            this.statusText.innerText = '拉取失败';
        }
    }

    downloadNotes() {
        const content = this.textarea.value;
        if (!content.trim()) {
            UIManager.showAlert("笔记为空，无需导出。");
            return;
        }
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `omni-notes-${new Date().toISOString().slice(0,10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async saveNotes() {
        if (!puter.auth.isSignedIn()) {
            this.statusText.innerText = '请登录后保存';
            return;
        }

        const content = this.textarea.value;
        this.statusText.innerText = '保存中...';
        this.saveBtn.disabled = true;

        try {
            await puter.kv.set('omni_ai_notes', content);
            this.statusText.innerText = '已保存至 Puter KV';
        } catch(e) {
            this.statusText.innerText = '保存失败: ' + e.message;
        } finally {
            this.saveBtn.disabled = false;
        }
    }
}

class OmniApp {
    constructor() {
        this.deviceAndPWA = new DeviceAndPWAModule();
        this.deployModule = new DeployModule();
        this.authManager = new AuthManager();
        this.chatModule = new ChatModule();
        this.imageModule = new ImageModule();
        this.voiceModule = new VoiceModule();
        this.notesModule = new NotesModule();

        this.initNavigation();
    }

    initNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const views = document.querySelectorAll('.module-view');
        const titleEl = document.getElementById('current-module-title');

        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = item.getAttribute('data-target');
                const targetTitle = item.getAttribute('data-title');
                
                // 更新激活状态的导航项
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');

                // 更新标题
                titleEl.innerText = targetTitle;

                // 更新视图
                views.forEach(view => {
                    if (view.id === targetId) {
                        view.classList.add('active');
                    } else {
                        view.classList.remove('active');
                    }
                });
            });
        });
    }
}

// 确保 Puter SDK 被干净地注入
document.addEventListener('DOMContentLoaded', () => {
    // 如果 puter 未定义，则显示致命错误提示
    if (typeof puter === 'undefined') {
        document.body.innerHTML = `
            <div style="display:flex; height:100vh; align-items:center; justify-content:center; background:#0f111a; color:#fff; flex-direction:column; gap:20px;">
                <i class="fa-solid fa-triangle-exclamation fa-4x" style="color:#ef4444;"></i>
                <h2>Puter SDK 加载失败</h2>
                <p>这通常是因为广告拦截插件（如 AdGuard）拦截了请求，或网络异常。</p>
                <button onclick="location.reload()" style="padding:10px 20px; background:#8b5cf6; color:#fff; border:none; border-radius:8px; cursor:pointer;">刷新重试</button>
            </div>
        `;
        return;
    }

    window.app = new OmniApp();
});
