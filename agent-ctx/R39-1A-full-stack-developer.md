# R39-1A 5套×7页型 Go template (aijjxs/23qb/ddyueshu/pilishuwu/101kks)

## 1. 读交接

- `go-backend/templates/shipsay/{book,category,read,ranking,fulltext,search,keyword}.html`
  (7 文件, ~600 行): Go template 写法 — `{{define "shipsay/<page>"}}...{{end}}` 包裹,
  顶部 head/charset/title/meta/clone-css link + body (header/nav/main/content/footer)
  全套 HTML, 数据用 {{.Site}}/{{.Book}}/{{.Chapters}}/{{.Books}}/{{.RecentChapters}}/
  {{.Related}}/{{.FirstChapterId}}/{{.Chapter}}/{{.Prev}}/{{.Next}}/{{.CatID}}/{{.Label}}/
  {{.Tabs}}/{{.Tab}}/{{.TabName}}/{{.HotBooks}}/{{.TopAuthors}}/{{.Page}}/{{.TotalPages}}/
  {{.PageList}}/{{.Total}}/{{.Q}}/{{.Tag}}/{{.RelatedTags}}/{{.NavCats}} (大写键 Site,
  小写键其他). 链接 /?view=book&id={{.id}}, /?view=read&chapter={{.id}},
  /?view=category&cat={{.id}}, /?view=ranking&sort={{.id}}, /?view=fulltext&page=N,
  /?view=search&q={{.Q}}, /?view=keyword&tag={{.Tag}}. 分页用 add/sub FuncMap 算上下页.
  章节正文用 `{{.Chapter.content}}` (main.go 已包 template.HTML, 无需再转义).
- `go-backend/main.go` (928 行): homeHandler 接管 `/`, switch view (book/read/category/
  ranking/fulltext/search/keyword/history/home) 8 分支, theme+view 拼模板名
  `tmplName = theme + "/" + view`, 失败 fallback shipsay/home. FuncMap 仅 6 个:
  wordCount (int → "X 万字"/"X 字") + statusLabel (completed → 完结, 其他 → 连载) +
  fmtDate (前 10 字符) + fmtDateShort (MMDD 4 字符) + add/sub (toInt 转换). 视图查询 9 个:
  getBookViewData (book + chapters 200 + recent 12 反转 + related 12 + firstChID) +
  getReadViewData (chapter content \n\n 自动包 <p> + 转义 <>& + template.HTML + book +
  prev/next idx 前后查) + getCategoryViewData (label + books + total) +
  getRankingViewData (ORDER BY updatedAt DESC, size → wordCount DESC) +
  getFulltextViewData (status='completed') + getSearchViewData (LIKE %q% on name/author/
  intro/keywords) + getKeywordViewData (BookTag JOIN Book + relatedTags 12).
- `src/components/public/clone-themes/<site>/*.tsx` (5 套 × 7 tsx = 35 tsx 文件,
  ~6000 行):
  · aijjxs: .top-float/.top-float-inner/.top-float-nav + .wrap/.top/.top-1/.logo + 
    form.search + main.layout > section (article.panel + .body.detail/.pic/.kv + 
    intro-panel + 下载与说明 + .grid2 猜您喜欢) + aside (article.panel.rank/.book_r/
    .lines/.no/.date + 上下部翻页) + footer.foot. category/fulltext/search/keyword:
    .cenMain/.articleInfo h1 + .body.filters 3 行 + .catalog .listbg (a.img/title/new/
    old+oldDate/div p intro + .mainGreen small/a/span) + .pager.
  · 23qb: #header.wrapper/.header-content/.banyundog-com/.header-logo/.slogan/.fixed-logo/
    .nav-search/.header-module/.nav-menu-items/.nav-menu-item + #search-content/.search-main/
    .search-box/.search-input.ac_wd/.search-btn search-cupfox/.search-btn search-go/
    .cancel-btn. main#main.wrapper/.content/.list/.box + .module-search-item/.novel-cover/
    .module-item-cover/.module-item-pic/.loading/.module-item-caption + .novel-info/
    .novel-info-header h3/.novel-info-aux/.tag-link + .novel-info-main/.novel-info-items/
    .novel-info-itemtitle/.novel-info-actor + .novel-info-content/.novel-info-footer/
    .btn-important/.btn-base. category/ranking/fulltext/keyword: .search-stat h1/h2 +
    .module/.module-list.module-lines-list/.module-items/.module-item/.module-item-cover/
    .module-item-top top{1-3}/.module-item-pic/.module-item-caption/.module-item-titlebox/
    .module-item-title/.module-item-text + #page (page-previous/strong/a/page-next).
    ranking: + .module-tab/.module-tab-items/.module-tab-item selected + .list-item/
    .item-title/.item/.order/.keyword. read: .article > main > .chepnav (a «上一章 +
    i· + a 下一章») + h1.article-title + .article-content + .chepnav 底部.
  · ddyueshu: #wrapper/.header/.header_logo/.header_search (form text+button) +
    .nav (ul/li 首页/cats/全本/足迹) + #main/#content/.content_read/.box_con/.con_top
    (面包屑 a > a > a) + #maininfo/#fmimg (img + .a/.b 完结/连载徽章) + #info (h1 + p×N) +
    #intro p + #list (dl/dt 最新章节/dd, dl/dt 开始阅读/dd) + #sidebar dl/dt/dd 同分类推荐 +
    .clear + .bottem1 (a 返回首页/查看目录). read: .bookname h1 + #content + .bottem1 +
    .bottem2 (上一章/返回书页/下一章). category: .novelslist h2 + .novellist-item 20% float +
    .image/.clear + .bottem1 分页. ranking: .novelslist h2 + tab 链接 + ul/li .s1-.s5
    (排名/书名/最新章节/作者/字数) + .bottem1. fulltext: .novellist h2 + ul/li + .novelslist.
    content h2 精选完本推荐 + .top .image dl/dt/dd. search: #newscontent/.l h2 + form +
    ul/li .s1-.s5 + .r h2 相关小说推荐 ul/li .s1/.s2/.s5. keyword: .novelslist h2 +
    3 column .content (h2 推荐 1/2/3 + .top .image dl/dt/dd + ul li .48% width) + 
    #firendlink 相关关键词.
  · pilishuwu: .mod-top-wr/.mod-top-frame/.mod-top-tool-wr.ui-wm/.mod-top-logo-wr/
    .mod-top-logo/.mod-top-event/.mod-top-search-wr (form action=/module/search/search.php
    + #top-search/.mod-top-search/.mod-search-input-wr/.mod-search-input/.mod-search-submit +
    ul.mod-top-tag#hotWord) + .mod-top-nav-tool/.mod-top-nav-wr/.mod-top-nav.ui-wm/
    .mod-top-nav-list (li.mod-top-nav-home 首页 + 全部小说 + 排行榜 + cats) +
    .mod-top-nav-user 域名发布页. book: ui-wm + .works-intro-wr/.works-intro/.works-cover
    (img + .works-cover-shadow + label.works-intro-status) + .works-intro-detail/
    .works-intro-text/.works-intro-head h2.works-intro-title + p.works-intro-short +
    .works-intro-opera/.works-intro-active/.works-intro-view.ui-btn-orange.ui-radius3 +
    .works-vote/.works-vote-list (li strong + .works-vote-btn + p) + #novel_data.works-status
    ul×4 + .ui-right.works-author-wr/.works-author-intro/.works-author-face/.works-author-info
    dl/dt/dd + .works-chapter-wr.works-stack/ul.words-xone-menu.works-chapter-menu/
    .works-chapter-list-tabcon/.works-chapter-list-con#chapter/.works-chapter-top/
    .works-chapter-log/.works-chapter-list-wr/ol.chapter-page-new.works-chapter-list +
    .ui-right.works-simi-wr/.works-title/ul.works-simi-list/li/.works-simi-cover/
    h5.works-simi-name + .works-more-wr.works-stack#youMayLike/h3.works-title-small/
    ul.mod-cover-list/li/.mod-cover-list-thumb.mod-cover-effect.ui-db/.mod-layer-mask/
    p.mod-cover-list-updata/a.mod-cover-list-mask/span.mod-cover-list-text/h5.
    a.mod-cover-list-name. category: .ret-side-wr/.category-left-rank/h3.rank-side-title/
    ol.custom-rank-list/li.rank-item/.rank-num/.rank-img/.rank-info/p.rank-t/p.rank-a/p.rank-s
    + .ret-main-wr/.ret-main/.ret-search-head (ul#search-condition.ret-search-type li a.
    ret-search-time + .ret-head-page + span.ret-result-num em) + .ret-search-result/
    ul.ret-search-list/li.ret-search-item/.ret-works-cover/a.mod-cover-list-thumb +
    .ret-works-info/h3.ret-works-title/p.ret-works-author/p.ret-works-tags/p.ret-works-decs/
    a.ret-works-view.ui-btn-pink + .ret-page-wr.mod-page (mod_page_next/current).
    read: .bookname h2 + .bottem1 (上一章/返回书页/下一章) + #booktxt.read-content-wr/
    #content.read-content + .bottem2 (»« 上一章/返回书页/下一章 »). ranking: .in-rank-wr/
    .mod-tab-handle/h2 热门排行/ul#top-rank-handle/li.active/a + #top-rank-panel.
    mod-tab-content-wr/.mod-tab-content clearfix/ol.in-rank-list ui-left ui-pr10 +
    ol.in-rank-list ui-left (li sub.in-rank-no-orange|in-rank-no-gray + a.in-rank-name +
    i.ui-rank-trend-keep) + .ret-page-wr.mod-page 分页. fulltext: .ret-main-wr/.ret-main/
    .ret-search-head (h1 全本完本小说 + .ret-search-type + .ret-result-num) +
    .ret-search-result/.ret-search-list/.ret-search-item + .ret-page-wr. search:
    .ret-main-wr/.ret-main/.ret-search-head (h1 搜索: span q + .ret-result-num em) +
    .ret-search-result. keyword: .ret-main-wr/.ret-main/.ret-search-head (h1 标签: span tag
    + .ret-result-num em) + .ret-search-result + .works-intro-tags 相关标签 .works-intro-tags-item.
  · 101kks (繁体 zh-TW): .leftmenu/.menu_close_btn/.headuser/.headimg/.register + 
    .menu2 (ul/li 首页/cats/閱讀記錄). header/.headbox.clearfix/.menubtn/.logo/.logoimg/
    form.search/.inputbox (icon-ArrowLeft + input searchkey + hidden searchtype=all) +
    .user1/.user_touxiang/.lang/.textsel/.zh_click × 2/.menu1 (ul/li 首頁/排行/完本/分類/
    我的書架/閱讀記錄). book: .main/.container/ul.row/li.col-8 + .mybox/.mytitle.shuye/
    .bread (首页 > 分类 > 书名) + .bookbox/.bookimg2 (span.status0|status1 + a img) +
    .booknav2 (h1 + p 作者/分类/字数|状态 + p 更新 + .sharebtn) + .addbtn (a.btn 開始閱讀/
    加入書架/投推薦票) + .txtcenter1 + .mybox/.infotag.clearfix/.tagtitle/ul.tagul +
    ul.tabs.clearfix (目录/简介/书评) + .tabsnav/#tab_info/ul.infolist (li 字数 + li 状态) +
    .navtxt (p 简介 + p 关键词) + a.btn.more-btn + col-4/.mybox/.mytitle 本周最強 +
    ul.tabs.tabshot.clearfix + .tabsnav/.ranking/ul (li.active/.rank_left/.ranktit/
    .rank_right/.imgbox2 + li .rank_left/.rank_right). category/fulltext/search/keyword:
    .mybox/ul.row/li.col-88 + h3.mytitle (.hottext label) + .newbox/ul#article_list_content
    /li (a.imgbox + .newnav h3 + .labelbox label×3 + ol.ellipsis_2 + .zxzj p span+a) +
    .newright (.piaos + .btn-tp 點擊閱讀 + .btn-jrsj 加入書架) + .pages/.pagelink
    (a.pgroup + a.prev + strong 当前 + a 各页 + a.next + a.ngroup). ranking: ul.tabs2.
    clearfix (li.active 總點擊/總推薦/字數榜/最近更新) + .newbox #article_list_content
    + .pages .pagelink. read: .black/.container/.mybox/.tools/ul/li (目录/设置/书签) +
    .txtnav h1 + .txtinfo (children) + .page1 (a 上一章 + a 返回書頁 + a 下一章). foot/
    .copyright (排行榜/最新更新/全部小說/熱門標籤 + Copyright 2023 + 友情連結 + Cookies
    Policy + DMCA).

## 2. 创建 35 个 Go template 文件

每文件结构: `{{define "<site>/<page>"}}<!DOCTYPE html>...<head><link rel="stylesheet"
href="/clone-css/<site>.css"></head><body>...</body></html>{{end}}`

- **aijjxs** (7 文件, ~830 行): 全用源站真实 class 名 (.page-info/.top-float/.top-float-inner/
  .top-float-nav/.wrap/.top/.top-1/.logo/.search/.layout/.cenMain/.articleInfo/.body.filters
  /.row/.catalog/.listbg/.img/.title/.new/.old/.oldDate/.mainGreen/.small/.panel/.body.detail/
  .pic/.kv/.intro-panel/.desc/.download-btn/.tips/.grid2/.book/.badge/.meta/.panel.rank/
  .book_r/.lines/.no/.date/.foot)
- **23qb** (7 文件, ~720 行): 繁体 (zh-Hant). 全用源站 class (#header.wrapper/.header-content/
  .banyundog-com/.header-logo/.slogan/.fixed-logo/.nav-search/.search-dh/.header-module/
  .nav-menu-items/.nav-menu-item/#search-content/.search-main/.search-box/.search-input.ac_wd/
  .search-btn search-cupfox/.search-btn search-go/.cancel-btn/#main.wrapper/.content/.list/.box/
  .module-search-item/.novel-cover/.module-item-cover/.module-item-pic/.loading/
  .module-item-caption/.novel-info/.novel-info-header/.novel-info-main/.novel-info-items/
  .novel-info-itemtitle/.novel-info-actor/.novel-info-content/.novel-info-footer/.btn-important/
  .btn-base/.module/.module-list.module-lines-list/.module-items/.module-item/.module-item-cover/
  .module-item-top top{1-3}/.module-item-pic/.module-item-titlebox/.module-item-title/
  .module-item-text/#page/.search-stat/.module-tab/.module-tab-items/.module-tab-item selected/
  .list-item/.item-title/.item/.order/.keyword/.page-previous/.page-next/.article/.chepnav/
  .article-title/.article-content)
- **ddyueshu** (7 文件, ~620 行): 全用源站 class (#wrapper/.header/.header_logo/.header_search/
  .nav/#main/#content/.content_read/.box_con/.con_top/#maininfo/#fmimg/.a/.b/#info/#intro/
  #list/dl/dt/dd/#sidebar/.clear/.bottem1/.bottem2/.footer/.novelslist/.novellist/
  .novellist-item/.image/.top/.content/#newscontent/.l/.r/.s1/.s2/.s3/.s4/.s5/#firendlink)
- **pilishuwu** (7 文件, ~980 行): 全用源站 class (.mod-top-wr/.mod-top-frame/.mod-top-tool-wr.
  ui-wm/.mod-top-logo-wr/.mod-top-logo/.mod-top-search-wr/.mod-top-search/.mod-search-input-wr/
  .mod-search-input/.mod-search-submit/.mod-top-tag/.mod-top-nav-tool/.mod-top-nav-wr/
  .mod-top-nav/.mod-top-nav-list/.mod-top-nav-home/.ui-wm/.ret-main-wr/.ret-main/
  .ret-search-head/.ret-search-type/.ret-search-time/.ret-head-page/.ret-result-num/
  .ret-search-result/.ret-search-list/.ret-search-item/.ret-works-cover/.mod-cover-list-thumb.
  mod-cover-effect.ui-db/.mod-layer-mask/.mod-cover-list-updata/.mod-cover-list-mask/
  .mod-cover-list-text/.ret-works-info/.ret-works-title/.ret-works-author/.ret-works-tags/
  .ret-works-decs/.ret-works-view.ui-btn-pink/.ret-page-wr.mod-page/.mod_page_next/.current/
  .ret-side-wr/.category-left-rank/.rank-side-title/.custom-rank-list/.rank-item/.rank-num/
  .rank-img/.rank-info/.rank-t/.rank-a/.rank-s/.in-rank-wr/.mod-tab-handle/.mod-tab-content-wr/
  .mod-tab-content/.in-rank-list/.in-rank-no-orange/.in-rank-no-gray/.in-rank-name/
  .ui-rank-trend-keep/.works-intro-wr/.works-intro/.works-cover/.works-cover-shadow/
  .works-intro-status/.works-intro-detail/.works-intro-text/.works-intro-head/
  .works-intro-title/.works-intro-short/.works-intro-opera/.works-intro-active/
  .works-intro-view.ui-btn-orange.ui-radius3/.works-vote/.works-vote-list/.works-vote-red/
  .works-vote-btn/.works-vote-black/.works-status/.works-chapter-wr.works-stack/
  .words-xone-menu.works-chapter-menu/.works-chapter-list-tabcon/.works-chapter-list-con#chapter/
  .works-chapter-top/.works-chapter-log/.works-chapter-item/.chapter-page-new.works-chapter-list/
  .works-more-wr/.works-title-small/.mod-cover-list/.linkBox/.linkTitle/.linkList/
  .mod-footer-wr/.mod-footer-main-wr/.mod-footer-main.ui-wm/.mod-footer-info/
  .mod-footer-border/.bookname/#booktxt.read-content-wr/#content.read-content)
- **101kks** (7 文件, ~880 行): 繁体 (zh-TW). 全用源站 class (.leftmenu/.menu_close_btn/
  .headuser/.headimg/.register/.menu2/header/.headbox.clearfix/.menubtn/.logo/.logoimg/
  form.search/.inputbox/.icon-ArrowLeft/.user1/.user_touxiang/.lang/.textsel/.zh_click/.menu1/
  .main/.container/.mybox/ul.row/li.col-8|li.col-4|li.col-88/.mytitle.shuye/.bread/.bookbox/
  .bookimg2/.status0|.status1/.booknav2/.addbtn/.btn/.sharebtn/.txtcenter1/.infotag.clearfix/
  .tagtitle/.tagul/ul.tabs.clearfix/.tabsnav/#tab_info/ul.infolist/.navtxt/.more-btn/
  .tabs.tabshot.clearfix/.ranking/.rank_left/.ranktit.ellipsis_1/.rank_right/.imgbox2/
  .newbox/#article_list_content/.imgbox/.newnav/.labelbox/.ellipsis_2/.zxzj/.newright/
  .piaos/.btn-tp/.btn-jrsj/.pages/.pagelink/.pgroup|.prev|.next|.ngroup/strong/.tabs2.clearfix/
  .black/.tools/.txtnav h1/.txtinfo/.page1/.foot/.copyright)

## 3. 编译确认

- `cd /home/z/my-project/go-backend && export PATH=$HOME/go/go/bin:$PATH && go build -o heis-backend . 2>&1 | tail -5`
  → EXIT=0 (0 errors, binary 20,209,608 bytes)
- `go vet ./...` → VET_EXIT=0 (0 warnings)
- 启动后端 + 加载模板: 86 个模板 (10 主题 × 8 视图 = 80 + 6 admin = 86) 无 parse error
  → "已加载 86 个模板" ✓

## 4. 端到端 40 测试 (5 主题 × 8 视图)

通过 5 套主题 + 2 套已有 DB site (23qb, 101kks) + 3 套临时插入 DB test site
(test-aijjxs, test-ddyueshu, test-pilishuwu, 测试后 DELETE 清理) 验证:

| 主题 | home | book | category | ranking | fulltext | search | keyword | read |
|---|---|---|---|---|---|---|---|---|
| aijjxs  | 200/3989B  | 200/34054B | 200/5616B  | 200/4161B | 200/3601B  | 200/4690B  | 200/6869B  | 200/20455B |
| 23qb    | 200/4528B  | 200/59021B | 200/3923B  | 200/4638B | 200/3265B  | 200/3399B  | 200/2803B  | 200/19246B* |
| ddyueshu| 200/4564B  | 200/53051B | 200/2729B  | 200/4165B | 200/2023B  | 200/3513B  | 200/9486B  | 200/19246B |
| pilishuwu| 200/6954B | 200/64235B | 200/6509B  | 200/5017B | 200/4708B  | 200/5663B  | 200/7924B  | 200/22252B |
| 101kks  | 200/7204B  | 200/73705B | 200/5140B  | 200/5619B | 200/4326B  | 200/5119B  | 200/8230B  | 200/22252B* |

(* 23qb 与 101kks 的 read 视图测试用 aijjxs 找到的 chapter ID cmu3axksv001zthtrx268g7dg
渲染也 OK, 数据规模 20-22KB 标准章节正文)

## 5. 关键 markers + 正文 <p> 验证

- markers (源站真实 class 名 grep): 全 5 主题各页型渲染出对应 class:
  · aijjxs/book: page-info/top-float/wrap/body detail/chapter_list/download-btn/foot/
    intro-panel/kv/panel rank ✓
  · 23qb/book: header-content/banyundog/btn-base/btn-important/module-search-item/nav-search/
    novel-cover/novel-info (header/items/itemtitle/actor/content/footer)/search-content ✓
  · ddyueshu/read: bookname/bottem1/bottem2/box_con/con_top/content/content_read/header_logo/
    header_search/nav ✓
  · pilishuwu/ranking: in-rank-list/in-rank-name/in-rank-no-orange/in-rank-wr/linkBox/
    mod-footer-info/mod-footer-main/mod-footer-wr/mod-search-input/mod-search-submit/
    mod-tab-handle/mod-top-frame/mod-top-logo/mod-top-logo-wr/mod-top-nav-home/mod-top-nav-list/
    mod-top-nav-wr/mod-top-search/mod-top-search-wr/mod-top-tool-wr ✓
  · 101kks/category: article_list_content/btn-jrsj/btn-tp/col-88/container/copyright/
    ellipsis_2/foot/headbox/hottext/imgbox/inputbox/labelbox/lang/leftmenu/logo/menu1/
    menubtn/mybox/mytitle ✓
- 正文 <p> 段落渲染 (非 &lt;p&gt; 转义): 全 5 主题 read 视图均输出
  `<p>大夏国，天蜀郡。</p><p>六月的南风城，骄阳似火，炙烤大地。</p><p>南风中等学府。</p>`
  真实段落 (main.go getReadViewData 已包 template.HTML 在 Chapter.content 字段, R38-1B 修复
  方案 5 主题一致受益) ✓

## 6. 未修改 (尊重约束)

- `go-backend/main.go` (已完成, 不动) ✓
- `go-backend/templates/shipsay/*` (已完成, 不动) ✓
- `go-backend/templates/{huangjinwu,ggd66,x2552,trxsw}/*` (B agent 负责, 不动) ✓
- `go-backend/templates/<site>/home.html` (各主题已有 home.html, 不动) ✓
- `go-backend/templates/admin/*` (admin 模板, 不动) ✓
- `src/*` (旧代码, 不动) ✓
- `prisma/schema.prisma` + `package.json` (0 新依赖) ✓
- 临时 DB 测试 site (test-aijjxs/test-ddyueshu/test-pilishuwu) 测试后 DELETE 清理,
  Site 表回归原 4 条 (测试站点/dewew/23qb-test/101kks-test) ✓

## 7. 修改文件清单

35 个新建文件 (0 修改):
- `go-backend/templates/aijjxs/{book,category,read,ranking,fulltext,search,keyword}.html` (7 文件)
- `go-backend/templates/23qb/{book,category,read,ranking,fulltext,search,keyword}.html` (7 文件)
- `go-backend/templates/ddyueshu/{book,category,read,ranking,fulltext,search,keyword}.html` (7 文件)
- `go-backend/templates/pilishuwu/{book,category,read,ranking,fulltext,search,keyword}.html` (7 文件)
- `go-backend/templates/101kks/{book,category,read,ranking,fulltext,search,keyword}.html` (7 文件)
