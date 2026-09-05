
// 配置常量（集中管理，便于维护）
const CONFIG = {
    CACHE_EXPIRE: 1000 * 60 * 60, // 缓存有效期1小时（可配置）
    LINES_PER_PAGE: 24,           // 每页显示24行
    LINES_PER_BLOCK: 12,          // 每个块显示12行
    SCROLL_THRESHOLD: 0.8,        // 滚动加载阈值
    DEBOUNCE_TIME: 150,           // 防抖时间（优化滚动性能）
    CACHE_PREFIX: 'novel_content_', // 缓存前缀
    // 过滤规则：数组形式，想加新规则直接往数组里加
    FILTER_RULES: [
        /更新不易.+?看最新章节！/g,
        /更新不易.+?看最新无错章节！/g,
        /更新不易.+?最新小说章节！/g,
        /速读谷/g,
        /shudugu.org/g,
        /速.读.谷/g,
        /速 读 谷/g,
        /看最新完整章節，就上速讀谷/g,
        /本章节未完.+?请订阅/g
    ]
};
// 唯一的内容过滤函数（支持多规则批量过滤）
function filterContent(content) {
    if (!content) return '';
    // 遍历所有过滤规则，依次替换
    CONFIG.FILTER_RULES.forEach(rule => {
        content = content.replace(rule, '');
    });
    return content;
}

const CacheManager = {
    isSupported() {
        try {
            const key = '__storage_test__';
            window.localStorage.setItem(key, key);
            window.localStorage.removeItem(key);
            return true;
        } catch (e) {
            return false;
        }
    },
    get(key) {
        if (!this.isSupported()) return null;
        
        try {
            const cacheItem = localStorage.getItem(key);
            if (!cacheItem) return null;
            
            const { content, timestamp } = JSON.parse(cacheItem);
            if (Date.now() - timestamp > CONFIG.CACHE_EXPIRE) {
                this.remove(key);
                return null;
            }
            return content;
        } catch (error) {
            console.error('缓存获取失败:', error);
            this.remove(key);
            return null;
        }
    },
    set(key, content) {
        if (!this.isSupported()) return;
        
        try {
            const cacheItem = JSON.stringify({
                content,
                timestamp: Date.now()
            });
            if (cacheItem.length > 5 * 1024 * 1024) {
                console.warn('内容过大，不进行缓存');
                return;
            }
            
            localStorage.setItem(key, cacheItem);
        } catch (error) {
            console.error('缓存设置失败:', error);
            this.cleanExpired();
        }
    },
    remove(key) {
        if (!this.isSupported()) return;
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.error('缓存移除失败:', error);
        }
    },
    clear() {
        if (!this.isSupported()) return;
        try {
            localStorage.clear();
        } catch (error) {
            console.error('缓存清空失败:', error);
        }
    },
    cleanExpired() {
        if (!this.isSupported()) return;
        try {
            const now = Date.now();
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(CONFIG.CACHE_PREFIX)) {
                    try {
                        const item = JSON.parse(localStorage.getItem(key));
                        if (now - item.timestamp > CONFIG.CACHE_EXPIRE) {
                            localStorage.removeItem(key);
                        }
                    } catch (e) {
                        localStorage.removeItem(key);
                    }
                }
            }
        } catch (error) {
            console.error('清理过期缓存失败:', error);
        }
    }
};

const NovelState = {
    fullChapterContent: null,       // 完整章节内容
    loadedBlocks: {1: false, 2: false},  // 已加载的内容块
    loadingBlock: null,             // 正在加载的块
    continuationHintAdded: false,   // 是否添加了内容提示
    allLines: [],                   // 存储所有行信息
    totalPages: 1,                  // 总页数
    currentPage: 1,                 // 当前页码
    currentArticleId: null,         // 当前文章ID
    currentChapterId: null,         // 当前章节ID
    init(articleId, chapterId, page = 1) {
        this.currentArticleId = articleId;
        this.currentChapterId = chapterId;
        this.currentPage = Math.max(1, page);
        this.fullChapterContent = null;
        this.loadedBlocks = {1: false, 2: false};
        this.loadingBlock = null;
        this.continuationHintAdded = false;
        this.allLines = [];
        this.totalPages = 1;
    },
    updateTotalPages() {
        this.totalPages = Math.ceil(this.allLines.length / CONFIG.LINES_PER_PAGE);
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages || 1;
        }
    }
};

const UrlUtils = {
    getQueryParam(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    },
    navigateToPage(page) {
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.set('page', page);
        window.location.assign(window.location.pathname + '?' + urlParams.toString());
    }
};

function initChapterContent(articleId, chapterId, initialPage = 1) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    NovelState.init(articleId, chapterId, initialPage);
    const contentEl = document.getElementById('chapter-content');
    if (!contentEl) {
        console.error('章节内容容器不存在');
        return;
    }

    contentEl.innerHTML = '<div class="loading">正在加载章节内容...</div>';

    const cacheKey = `${CONFIG.CACHE_PREFIX}${articleId}_${chapterId}`;
    const cachedContent = CacheManager.get(cacheKey);

    if (cachedContent) {
        console.log(`使用缓存内容：文章ID=${articleId}, 章节ID=${chapterId}, 页码=${NovelState.currentPage}`);
        // 加载缓存内容时也过滤
        processChapterContent(filterContent(cachedContent));
        return;
    }
    //const tokenData = generateToken();
    const tokenData = {
    token: chapterToken,
    timestamp: timestamp,
    nonce: nonce
};
    $.ajax({
      //url: 'https://www.deqixs.cc/modules/article/ajax_chapter.php',
        url: 'https://www.deqixs.cc/modules/article/ajax2.php',
        method: 'GET',
        data: {
            aid: articleId,
            cid: chapterId,
            token: tokenData.token,
            timestamp: tokenData.timestamp,
            nonce: tokenData.nonce
        },
        dataType: 'text',
        xhr: function() {
            const xhr = $.ajaxSettings.xhr();
            if (xhr.overrideMimeType) {
                xhr.overrideMimeType('application/octet-stream');
            }
            return xhr;
        },
        success: function(gbkData) {
            try {
                const content = gbkToString(gbkData);
                const jsonData = JSON.parse(content);

                if (jsonData.status === 1 && jsonData.data.content) {
                    // 过滤后再缓存
                    const filteredContent = filterContent(jsonData.data.content);
                    CacheManager.set(cacheKey, filteredContent);
                    processChapterContent(filteredContent);
                } else {
                    contentEl.innerHTML = '<div class="error">获取章节内容失败: ' + (jsonData.message || '未知错误') + '</div>';
                }
            } catch (e) {
                contentEl.innerHTML = '<div class="error">解析章节内容失败: ' + e.message + '</div>';
                console.error('解析错误:', e);
            }
        },
        error: function(jqXHR, textStatus, errorThrown) {
            contentEl.innerHTML = '<div class="error">获取章节内容失败: ' + textStatus + ' - ' + errorThrown + '</div>';
            console.error('AJAX错误:', textStatus, errorThrown);
        }
    });
}

function processChapterContent(content) {
    NovelState.fullChapterContent = content;
    parseAllLines(content);
    NovelState.updateTotalPages();
    const contentEl = document.getElementById('chapter-content');
    contentEl.innerHTML = '';
    loadBlock(NovelState.currentPage, 1);
    setupScrollListener();
    updatePageInfo();
    updatePaginationButtonText();
}

function parseAllLines(content) {
    NovelState.allLines = [];
    let currentLine = '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    function extractLines(node) {
        if (node.nodeType === 3) {
            const text = node.textContent.trimStart();
            if (text) {
                currentLine += text;
            }
        } else if (node.nodeType === 1) {
            const tagName = node.tagName.toLowerCase();
            if (tagName === 'br') {
                if (currentLine.trim() !== '') {
                    NovelState.allLines.push(currentLine);
                    currentLine = '';
                }
            } else if (tagName === 'p' || tagName === 'div') {
                for (let i = 0; i < node.childNodes.length; i++) {
                    extractLines(node.childNodes[i]);
                }
                if (currentLine.trim() !== '') {
                    NovelState.allLines.push(currentLine);
                    currentLine = '';
                }
                if (node.nextSibling) {
                    NovelState.allLines.push('');
                }
            } else {
                for (let i = 0; i < node.childNodes.length; i++) {
                    extractLines(node.childNodes[i]);
                }
            }
        }
    }
    extractLines(tempDiv);
    if (currentLine.trim() !== '') {
        NovelState.allLines.push(currentLine);
    }
    NovelState.allLines = NovelState.allLines.filter((line, index, arr) => {
        if (line === '') {
            return index < arr.length - 1 && arr[index + 1] !== '';
        }
        return true;
    });
}

function updatePageInfo() {
    // 定位页面中真实存在的、显示 第一章的h1（class=pt10）
    const pageInfo = document.querySelector('h1.pt10');
    if (pageInfo) {
        // 核心：保留原有标题 + 拼接JS计算的当前页/总页数，和你最初写法一致
        pageInfo.innerHTML = ' 第一章(第' + NovelState.currentPage + '/' + NovelState.totalPages + '页)';
    }
}

function loadBlock(page, blockNum) {
    if (NovelState.loadedBlocks[blockNum] || NovelState.loadingBlock === blockNum) return;

    const contentEl = document.getElementById('chapter-content');
    let blockContainer = document.getElementById(`block-${blockNum}`);

    if (!blockContainer) {
        blockContainer = document.createElement('div');
        blockContainer.id = `block-${blockNum}`;
        blockContainer.className = 'chapter-block';
        blockContainer.innerHTML = '加载中...';
        if (blockNum === 1) {
            contentEl.appendChild(blockContainer);
        } else {
            const prevBlock = document.getElementById(`block-${blockNum-1}`);
            if (prevBlock) {
                prevBlock.parentNode.insertBefore(blockContainer, prevBlock.nextSibling);
            } else {
                contentEl.appendChild(blockContainer);
            }
        }
    }
    NovelState.loadingBlock = blockNum;
    setTimeout(() => {
        try {
            if (NovelState.fullChapterContent) {
                displayBlockContent(page, blockNum);
                NovelState.loadedBlocks[blockNum] = true;
                NovelState.loadingBlock = null;
                if (blockNum === 1 && !NovelState.continuationHintAdded) {
                    addContinuationHint();
                    NovelState.continuationHintAdded = true;
                }
                if (blockNum < 2 && !document.getElementById(`block-${blockNum+1}`)) {
                    const nextBlockPlaceholder = document.createElement('div');
                    nextBlockPlaceholder.id = `block-${blockNum+1}`;
                    nextBlockPlaceholder.className = 'chapter-block placeholder';
                    nextBlockPlaceholder.innerHTML = '加载中...';
                    contentEl.appendChild(nextBlockPlaceholder);
                }
            }
        } catch (error) {
            console.error(`加载区块 ${blockNum} 失败:`, error);
            blockContainer.innerHTML = '<div class="error">区块加载失败，请刷新页面重试</div>';
            NovelState.loadingBlock = null;
        }
    }, 200);
}

function displayBlockContent(page, blockNum) {
    const blockEl = document.getElementById(`block-${blockNum}`);
    if (!blockEl) return;
    const startLine = (page - 1) * CONFIG.LINES_PER_PAGE + (blockNum - 1) * CONFIG.LINES_PER_BLOCK;
    const endLine = Math.min(startLine + CONFIG.LINES_PER_BLOCK, NovelState.allLines.length);
    const currentBlockLines = NovelState.allLines.slice(startLine, endLine);
    let blockContent = '';
    currentBlockLines.forEach((line, index) => {
        if (line === '') {
            if (index > 0 && currentBlockLines[index - 1] !== '') {
                blockContent += '<br><br>';
            }
        } else {
            const indentedLine = '&nbsp;&nbsp;&nbsp;&nbsp;' + line.replace(/\n/g, '<br>&nbsp;&nbsp;&nbsp;&nbsp;');
            blockContent += indentedLine;
            if (index < currentBlockLines.length - 1) {
                blockContent += '<br><br>';
            }
        }
    });

    blockEl.innerHTML = blockContent;
}

function setupScrollListener() {
    window.removeEventListener('scroll', handleScroll);
    window.addEventListener('scroll', handleScroll);
    setTimeout(() => {
        handleScroll();
    }, 100);
}

let scrollTimeout;
function handleScroll() {
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(() => {
        // 先处理第一个块的加载逻辑（原有逻辑不变）
        if (!NovelState.loadedBlocks[1] && NovelState.loadingBlock !== 1) {
            const block1 = document.getElementById(`block-1`);
            if (block1) {
                const rect = block1.getBoundingClientRect();
                const windowHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= windowHeight * CONFIG.SCROLL_THRESHOLD) {
                    loadBlock(NovelState.currentPage, 1);
                }
            }
        }

        // 重点修改：第二个块的加载逻辑改为依赖第一个块的滚动位置
        if (!NovelState.loadedBlocks[2] && NovelState.loadingBlock !== 2 && NovelState.loadedBlocks[1]) {
            const block1 = document.getElementById(`block-1`);
            if (block1) {
                const rect = block1.getBoundingClientRect();
                const windowHeight = window.innerHeight || document.documentElement.clientHeight;
                // 计算第一个块已经滚动过的高度比例（滚动到50%时触发）
                const block1TotalHeight = rect.bottom - rect.top;
                const block1ScrolledHeight = windowHeight - rect.top;
                const scrollRatio = block1ScrolledHeight / block1TotalHeight;
                
                // 当滚动比例达到50%（0.5）时加载第二个块
                if (scrollRatio >= CONFIG.SCROLL_THRESHOLD) {
                    loadBlock(NovelState.currentPage, 2);
                    // 加载第二个块后移除提示文字
                    if (NovelState.continuationHintAdded) {
                        removeContinuationHint();
                    }
                }
            }
        }
    }, CONFIG.DEBOUNCE_TIME);
}

function addContinuationHint() {
    const block1 = document.getElementById('block-1');
    if (block1) {
        const hintText = '<br>当&前@章#节$内%容^不&完*整！要~查!看-完_整|章;节)请(退&出%阅#读|模*式！';
        block1.innerHTML += hintText;
    }
}

function removeContinuationHint() {
    const block1 = document.getElementById('block-1');
    if (block1) {
        const html = block1.innerHTML;
        const hintText = '当&前@章#节$内%容^不&完*整！要~查!看-完_整|章;节)请(退&出%阅#读|模*式！';
        const lastBrIndex = html.lastIndexOf('<br>');

        if (lastBrIndex !== -1) {
            const contentBeforeHint = html.substring(0, lastBrIndex);
            block1.innerHTML = contentBeforeHint;
            NovelState.continuationHintAdded = false;
        }
    }
}

function goToPage(page) {
    if (page < 1 || page > NovelState.totalPages) return false;
    if (page === NovelState.currentPage) return true;
    UrlUtils.navigateToPage(page);
    return true;
}

function prevPage() {
    return goToPage(NovelState.currentPage - 1);
}

function nextPage() {
    return goToPage(NovelState.currentPage + 1);
}

function gbkToString(gbkData) {
    if (typeof gbkData === 'string') {
        return gbkData;
    } else if (gbkData instanceof ArrayBuffer) {
        try {
            if (window.TextDecoder) {
                const decoder = new TextDecoder('gbk');
                return decoder.decode(gbkData);
            } else {
                const dataView = new DataView(gbkData);
                const str = [];
                let i = 0;
                const len = dataView.byteLength;

                while (i < len) {
                    const byte1 = dataView.getUint8(i);
                    if (byte1 < 0x80) {
                        str.push(String.fromCharCode(byte1));
                        i++;
                    } else {
                        if (i + 1 < len) {
                            const byte2 = dataView.getUint8(i + 1);
                            str.push(String.fromCharCode(byte1, byte2));
                            i += 2;
                        } else {
                            str.push(String.fromCharCode(byte1));
                            i++;
                        }
                    }
                }
                return str.join('');
            }
        } catch (e) {
            console.error('GBK转码失败:', e);
            return '';
        }
    }
    return '';
}

function initPaginationButtons() {
    $('.page-prev').on('click', function(e) {
        e.preventDefault();
        if (NovelState.currentPage > 1) {
            prevPage();
        } else {
            loadChapter('prev');
        }
    });
    $('.page-next').on('click', function(e) {
        e.preventDefault();
        if (NovelState.currentPage < NovelState.totalPages) {
            nextPage();
        } else {
            loadChapter('next');
        }
    });
    $('.page-index').on('click', function(e) {
        e.preventDefault();
        window.location.href = $(this).data('href');
    });
    updatePaginationButtonText();
}

function updatePaginationButtonText() {
    const prevBtn = $('.page-prev');
    const nextBtn = $('.page-next');
    if (NovelState.currentPage > 1) {
        prevBtn.text('上一页');
    } else {
        prevBtn.text('上一章');
    }
    if (NovelState.currentPage < NovelState.totalPages) {
        nextBtn.text('下一页');
    } else {
        nextBtn.text('下一章');
    }
}

function loadChapter(direction) {
    let chapterUrl = '';
    if (direction === 'prev') {
        chapterUrl = 'https://www.deqixs.cc/books/126/';
    } else {
        chapterUrl = 'https://www.deqixs.cc/books/126/81418.html';
    }
    if (!chapterUrl || chapterUrl === '#') {
        alert(direction === 'prev' ? '已经是第一章' : '已经是最后一章');
        return;
    }
    try {
        const url = new URL(chapterUrl, window.location.origin);
        const path = url.pathname.split('/');
        let articleId = null, chapterId = null;

        if (path[2] === 'book' && path[3]) {
            articleId = parseInt(path[3]);
        }
        if (path[4]) {
            chapterId = parseInt(path[4].split('_')[0] || path[4].split('.')[0]);
        }

        if (articleId && chapterId) {
            window.scrollTo({ top: 0, behavior: 'auto' });
            initChapterContent(articleId, chapterId, 1);
        } else {
            window.location.href = chapterUrl;
        }
    } catch (err) {
        console.error('解析章节URL错误:', err);
        window.location.href = chapterUrl;
    }
}

$(document).ready(function() {
    window.scrollTo({ top: 0, behavior: 'auto' });
    const articleId = 126;
    const chapterId = 81417;
    const initialPage = parseInt(UrlUtils.getQueryParam('page')) || 1;
    if (articleId && chapterId) {
        initChapterContent(articleId, chapterId, initialPage);
        initPaginationButtons();
    } else {
        const contentEl = document.getElementById('chapter-content');
        if (contentEl) {
            contentEl.innerHTML = '<div class="error">文章ID或章节ID缺失</div>';
        }
    }
    document.onkeydown = function(event) {
        const e = event || window.event;
        if (e.keyCode === 37) { // 左箭头
            if (NovelState.currentPage > 1) {
                prevPage();
            } else {
                loadChapter('prev');
            }
        } else if (e.keyCode === 39) { // 右箭头
            if (NovelState.currentPage < NovelState.totalPages) {
                nextPage();
            } else {
                loadChapter('next');
            }
        }
    };
});
