/**
 * GOAL-043 & GOAL-044 客户端交互逻辑 (Ponytail Client Scripts)
 */

export function getCollaborationClientScript(): string {
  return `
  // 协作模式状态与切换 (GOAL-043)
  let currentCollabMode = 'free';
  let activeDebateId = null;

  function initCollaborationUI() {
    const capsules = document.querySelectorAll('.mode-capsule');
    const pairIndicator = document.getElementById('collab-pair-indicator');
    const debateView = document.getElementById('view-debate') || document.getElementById('debate-view');

    capsules.forEach(cap => {

      cap.addEventListener('click', () => {
        capsules.forEach(c => c.classList.remove('active'));
        cap.classList.add('active');
        currentCollabMode = cap.getAttribute('data-mode') || 'free';

        const pipelineView = document.getElementById('view-pipeline');
        const redblueView = document.getElementById('view-redblue');
        if (currentCollabMode === 'debate') {
          if (pairIndicator) pairIndicator.style.display = 'flex';
          if (debateView) debateView.style.display = 'flex';
          if (pipelineView) pipelineView.style.display = 'none';
          if (redblueView) redblueView.style.display = 'none';
          fetchRecommendedPair();
          loadDebatesUI();
        } else if (currentCollabMode === 'pipeline') {
          if (pairIndicator) pairIndicator.style.display = 'none';
          if (debateView) debateView.style.display = 'none';
          if (pipelineView) pipelineView.style.display = 'flex';
          if (redblueView) redblueView.style.display = 'none';
          loadPipelinesUI();
        } else if (currentCollabMode === 'verify') {
          if (pairIndicator) pairIndicator.style.display = 'flex';
          if (debateView) debateView.style.display = 'none';
          if (pipelineView) pipelineView.style.display = 'none';
          if (redblueView) redblueView.style.display = 'flex';
          fetchRecommendedPair();
          loadRedBlueUI();
        } else {
          if (pairIndicator) pairIndicator.style.display = 'none';
          if (debateView) debateView.style.display = 'none';
          if (pipelineView) pipelineView.style.display = 'none';
          if (redblueView) redblueView.style.display = 'none';
        }
      });
    });

    const ALL_DOGS = ['claude-code', 'deepseek-dsh', 'kimi-code', 'agy', 'codex', 'zcode', 'opencode'];

    function populateDogSelects() {
      const selP = document.getElementById('select-primary-dog');
      const selO = document.getElementById('select-opposing-dog');
      const curP = (document.getElementById('indicator-primary-dog') || {}).textContent || 'claude-code';
      const curO = (document.getElementById('indicator-opposing-dog') || {}).textContent || 'deepseek-chat';

      if (selP && selO) {
        selP.innerHTML = ALL_DOGS.map(function (d) { return '<option value="' + d + '" ' + (d === curP ? 'selected' : '') + '>' + d + '</option>'; }).join('');
        selO.innerHTML = ALL_DOGS.map(function (d) { return '<option value="' + d + '" ' + (d === curO ? 'selected' : '') + '>' + d + '</option>'; }).join('');
      }

    }

    // 调配弹窗开关
    const btnSwitchPair = document.getElementById('btn-switch-pair');
    const indPrimary = document.getElementById('indicator-primary-dog');
    const indOpposing = document.getElementById('indicator-opposing-dog');
    const pairPop = document.getElementById('collab-pair-selector-pop');
    const btnClosePop = document.getElementById('btn-close-pair-pop');
    const btnSwapPair = document.getElementById('btn-swap-pair');
    const btnApplyPair = document.getElementById('btn-apply-pair');

    const togglePairPop = (e) => {
      if (e) e.stopPropagation();
      if (!pairPop) return;
      const isHidden = pairPop.style.display === 'none' || !pairPop.style.display;
      if (isHidden) {
        populateDogSelects();
        pairPop.style.display = 'block';
      } else {
        pairPop.style.display = 'none';
      }
    };

    if (btnSwitchPair) btnSwitchPair.addEventListener('click', togglePairPop);
    if (indPrimary) indPrimary.addEventListener('click', togglePairPop);
    if (indOpposing) indOpposing.addEventListener('click', togglePairPop);
    if (btnClosePop) btnClosePop.addEventListener('click', () => { if (pairPop) pairPop.style.display = 'none'; });

    if (btnSwapPair) {
      btnSwapPair.addEventListener('click', () => {
        const selP = document.getElementById('select-primary-dog');
        const selO = document.getElementById('select-opposing-dog');
        if (selP && selO) {
          const tmp = selP.value;
          selP.value = selO.value;
          selO.value = tmp;
        }
      });
    }

    if (btnApplyPair) {
      btnApplyPair.addEventListener('click', () => {
        const selP = document.getElementById('select-primary-dog');
        const selO = document.getElementById('select-opposing-dog');
        const pVal = selP ? selP.value : 'claude-code';
        const oVal = selO ? selO.value : 'deepseek-dsh';

        const pDog = document.getElementById('indicator-primary-dog');
        const oDog = document.getElementById('indicator-opposing-dog');
        const pCol = document.getElementById('pro-dog-name');
        const cCol = document.getElementById('con-dog-name');
        const pBadge = document.getElementById('pro-column-badge');
        const cBadge = document.getElementById('con-column-badge');
        const rGen = document.getElementById('redblue-generator-dog');
        const rVer = document.getElementById('redblue-verifier-dog');

        if (pDog) pDog.textContent = pVal;
        if (oDog) oDog.textContent = oVal;
        if (pCol) pCol.textContent = pVal;
        if (cCol) cCol.textContent = oVal;
        if (pBadge) pBadge.textContent = pVal;
        if (cBadge) cBadge.textContent = oVal;
        if (rGen) rGen.textContent = pVal;
        if (rVer) rVer.textContent = oVal;

        if (pairPop) pairPop.style.display = 'none';
      });
    }

    // 仲裁按钮绑定
    const btnPro = document.getElementById('btn-arbitrate-pro');
    const btnCon = document.getElementById('btn-arbitrate-con');
    const btnMerge = document.getElementById('btn-arbitrate-merge');

    if (btnPro) btnPro.addEventListener('click', () => submitArbitration('PRO'));
    if (btnCon) btnCon.addEventListener('click', () => submitArbitration('CON'));
    if (btnMerge) btnMerge.addEventListener('click', () => submitArbitration('MERGED'));

    // 流水线与攻防按钮绑定 (GOAL-045 & GOAL-046)
    const btnPipelineRefresh = document.getElementById('btn-pipeline-refresh');
    if (btnPipelineRefresh) btnPipelineRefresh.addEventListener('click', loadPipelinesUI);
    const btnApproveGate = document.getElementById('btn-approve-gate');
    if (btnApproveGate) {
      btnApproveGate.addEventListener('click', async () => {
        try {
          // GOAL-067（P1-11）修复三连：
          // a) 数据源改走真实存在的 GET /api/snapshot（旧 GET /api/approvals 路由不存在，恒 404）；
          // b) 应答字段名对齐服务端契约 request_file（旧 file 字段必 400）；
          // c) 补 x-mush-caller-auth 头（强制鉴权模式下裸 fetch 必 401）。
          const authMeta = document.querySelector('meta[name="mush-caller-auth"]');
          const authVal = authMeta ? (authMeta.getAttribute('content') || '') : '';
          const res = await fetch('/api/snapshot');
          const data = await res.json();
          if (data && data.approvals && data.approvals.length > 0) {
            const waiting = data.approvals.find(a => a.status === 'WAITING');
            if (waiting) {
              await fetch('/api/approvals/respond', {
                method: 'POST',
                headers: Object.assign(
                  { 'content-type': 'application/json' },
                  authVal ? { 'x-mush-caller-auth': authVal } : {}
                ),
                body: JSON.stringify({ request_file: waiting.request_file, decision: 'APPROVED' })
              });
              loadPipelinesUI();
              return;
            }
          }
          loadPipelinesUI();
        } catch {}
      });
    }

    const btnRedBlueRefresh = document.getElementById('btn-redblue-refresh');
    if (btnRedBlueRefresh) btnRedBlueRefresh.addEventListener('click', loadRedBlueUI);

    // 悬赏大厅、技能联邦、时空穿梭、共享黑板、液态小队、ELO 天梯与进化路由按钮绑定 (GOAL-047 ~ GOAL-053)
    const btnBountyRefresh = document.getElementById('btn-bounty-refresh');
    if (btnBountyRefresh) btnBountyRefresh.addEventListener('click', loadBountiesUI);
    const btnAutoMatchBid = document.getElementById('btn-auto-match-bid');
    if (btnAutoMatchBid) {
      btnAutoMatchBid.addEventListener('click', () => {
        autoMatchBestBid();
      });
    }
    const btnSkillsRefresh = document.getElementById('btn-skills-refresh');
    if (btnSkillsRefresh) btnSkillsRefresh.addEventListener('click', loadSkillsUI);
    const btnTimeTravelRefresh = document.getElementById('btn-timetravel-refresh');
    if (btnTimeTravelRefresh) btnTimeTravelRefresh.addEventListener('click', loadTimeTravelUI);
    const btnBlackboardRefresh = document.getElementById('btn-blackboard-refresh');
    if (btnBlackboardRefresh) btnBlackboardRefresh.addEventListener('click', loadBlackboardUI);
    const btnSquadsRefresh = document.getElementById('btn-squads-refresh');
    if (btnSquadsRefresh) btnSquadsRefresh.addEventListener('click', loadSquadsUI);
    const btnEloRefresh = document.getElementById('btn-elo-refresh');
    if (btnEloRefresh) btnEloRefresh.addEventListener('click', loadEloUI);
    const btnRoutingRefresh = document.getElementById('btn-routing-refresh');
    if (btnRoutingRefresh) btnRoutingRefresh.addEventListener('click', loadRoutingUI);
  }


  async function loadRoutingUI() {

    try {
      const res = await fetch('/api/routing/weights');
      const data = await res.json();
      if (data.ok) {
        const countEl = document.getElementById('routing-stat-feedback-count');
        if (countEl) countEl.textContent = data.count || 0;
      }
    } catch {}
  }

  var currentEloHarnessFilter = 'all';
  var allEloRankings = [];

  function renderEloTableRows() {
    var tbody = document.getElementById('elo-rankings-tbody');
    if (!tbody) return;
    var filtered = currentEloHarnessFilter === 'all'
      ? allEloRankings
      : allEloRankings.filter(function (r) {
          var hid = (r.harness_id || r.adapter_id || '').toLowerCase();
          return hid.indexOf(currentEloHarnessFilter.toLowerCase()) !== -1;
        });

    function escHtml(value) {
      // GOAL-067（P3）：与主层 esc() 同实现，保留薄别名以维持视图内调用点可读。
      return esc(value);
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">该分类下暂无 ELO 战绩记录</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (r, idx) {
      var rankBadge = idx === 0 ? '🥇 1' : (idx === 1 ? '🥈 2' : (idx === 2 ? '🥉 3' : String(idx + 1)));
      var harnessName = escHtml(r.harness_id || r.adapter_id || 'unknown');
      var rawProvider = r.provider_name || (harnessName.indexOf('agy') !== -1 ? 'Google OAuth' : (harnessName.indexOf('claude') !== -1 ? 'everyapi' : (harnessName.indexOf('deepseek') !== -1 ? 'poke2api' : 'Default')));
      var providerName = escHtml(rawProvider);
      var rawModel = r.model_id || (harnessName.indexOf('agy') !== -1 ? 'gemini-3.7-flash-high' : (harnessName.indexOf('claude') !== -1 ? 'claude-sonnet-4-6' : 'default'));
      var modelName = escHtml(rawModel);
      var tierClass = 'tier-' + (r.rank_tier ? String(r.rank_tier).toLowerCase().replace(/[^a-z0-9_-]/g, '') : 'silver');
      // GOAL-067（P2-14）：字段缺失/非数值时显示占位，不再渲染 'NaN%'。
      var winRatePercent = (typeof r.win_rate === 'number' && isFinite(r.win_rate))
        ? (r.win_rate * 100).toFixed(1) + '%'
        : '—';
      return '<tr>' +
        '<td style="font-weight:bold;text-align:center">' + rankBadge + '</td>' +
        '<td class="mono"><strong>' + harnessName + '</strong></td>' +
        '<td><span class="provider-tag-active">' + providerName + '</span></td>' +
        '<td class="mono">' + modelName + '</td>' +
        '<td><span class="tier-badge ' + tierClass + '">' + escHtml(r.rank_tier || 'Silver') + '</span></td>' +
        '<td class="mono" style="font-weight:bold;color:#1d4ed8">' + escHtml(r.elo_rating) + '</td>' +
        '<td>' + escHtml(r.wins) + '胜 / ' + escHtml(r.draws) + '平 / ' + escHtml(r.losses) + '负</td>' +
        '<td style="font-weight:bold">' + winRatePercent + '</td>' +
      '</tr>';
    }).join('');
  }

  async function loadEloUI() {
    try {
      var res = await fetch('/api/elo/rankings');
      var data = await res.json();
      if (data.ok && data.rankings) {
        allEloRankings = data.rankings;
        var topEl = document.getElementById('elo-stat-top-dog');
        var matchesEl = document.getElementById('elo-stat-total-matches');
        var winEl = document.getElementById('elo-stat-highest-winrate');
        if (data.rankings.length > 0) {
          if (topEl) topEl.textContent = (data.rankings[0].harness_id || data.rankings[0].adapter_id) + ' (' + data.rankings[0].elo_rating + ')';
          var totalMatches = data.rankings.reduce(function (sum, r) { return sum + (typeof r.matches_played === 'number' ? r.matches_played : 0); }, 0);
          if (matchesEl) matchesEl.textContent = Math.floor(totalMatches / 2);
          var numericWinRates = data.rankings.map(function (r) { return typeof r.win_rate === 'number' && isFinite(r.win_rate) ? r.win_rate : -1; });
          var maxWin = Math.max.apply(Math, numericWinRates);
          if (winEl) winEl.textContent = maxWin >= 0 ? (maxWin * 100).toFixed(1) + '%' : '—';
        }

        // Render filter pills
        var filterContainer = document.getElementById('elo-harness-filters');
        if (filterContainer) {
          var seen = {};
          var harnesses = ['all'];
          for (var i = 0; i < allEloRankings.length; i++) {
            var hId = allEloRankings[i].harness_id || allEloRankings[i].adapter_id || '';
            if (hId && !seen[hId]) {
              seen[hId] = true;
              harnesses.push(hId);
            }
          }
          filterContainer.innerHTML = harnesses.map(function (h) {
            var activeCls = h === currentEloHarnessFilter ? 'active' : '';
            var label = h === 'all' ? '全部 (All)' : h;
            var safeH = String(h).replace(/[&<>"']/g, '');
            var safeLabel = String(label).replace(/[&<>"']/g, '');
            return '<button type="button" class="elo-filter-pill ' + activeCls + '" data-harness="' + safeH + '">' + safeLabel + '</button>';
          }).join('');

          filterContainer.querySelectorAll('.elo-filter-pill').forEach(function (btn) {
            btn.addEventListener('click', function () {
              currentEloHarnessFilter = btn.getAttribute('data-harness') || 'all';
              filterContainer.querySelectorAll('.elo-filter-pill').forEach(function (b) { b.classList.remove('active'); });
              btn.classList.add('active');
              renderEloTableRows();
            });
          });
        }

        renderEloTableRows();
      }
    } catch {}
  }



  async function loadSquadsUI() {
    try {
      const res = await fetch('/api/squads');
      const data = await res.json();
      if (data.ok && data.squads) {
        const activeEl = document.getElementById('squads-stat-active');
        const disbandedEl = document.getElementById('squads-stat-disbanded');
        const activeList = data.squads.filter(s => s.status === 'ACTIVE');
        const disbandedList = data.squads.filter(s => s.status === 'DISBANDED');
        if (activeEl) activeEl.textContent = activeList.length;
        if (disbandedEl) disbandedEl.textContent = disbandedList.length;
      }
    } catch {}
  }

  async function loadBlackboardUI() {
    try {
      const res = await fetch('/api/blackboard');
      const data = await res.json();
      if (data.ok && data.sections) {
        const artEl = document.getElementById('bb-stat-artifacts');
        const issEl = document.getElementById('bb-stat-issues');
        const hypEl = document.getElementById('bb-stat-hypotheses');
        const decEl = document.getElementById('bb-stat-decisions');
        if (artEl) artEl.textContent = data.sections.artifacts ? data.sections.artifacts.length : 0;
        if (issEl) issEl.textContent = data.sections.issues ? data.sections.issues.length : 0;
        if (hypEl) hypEl.textContent = data.sections.hypotheses ? data.sections.hypotheses.length : 0;
        if (decEl) decEl.textContent = data.sections.decisions ? data.sections.decisions.length : 0;
      }
    } catch {}
  }

  async function loadTimeTravelUI() {
    try {
      const res = await fetch('/api/time-travel/tree');
      const data = await res.json();
      if (data.ok && data.nodes) {
        const totalEl = document.getElementById('timetravel-stat-total-nodes');
        const branchEl = document.getElementById('timetravel-stat-branches');
        if (totalEl) totalEl.textContent = data.nodes.length;
        if (branchEl && data.branches) branchEl.textContent = Object.keys(data.branches).length + ' 个分支';
      }
    } catch {}
  }

  async function loadSkillsUI() {
    try {
      const res = await fetch('/api/skills');
      const data = await res.json();
      if (data.ok && data.skills) {
        const totalEl = document.getElementById('skills-stat-total-count');
        const dirEl = document.getElementById('skills-stat-mounted-dirs');
        if (totalEl) totalEl.textContent = data.total || data.skills.length;
        if (dirEl && data.mounted_directories) dirEl.textContent = data.mounted_directories.length;
      }
    } catch {}
  }

  async function loadBountiesUI() {
    try {
      const res = await fetch('/api/bounties');
      const data = await res.json();
      if (data.ok && data.bounties) {
        const openCount = data.bounties.filter(b => b.status === 'OPEN').length;
        const biddingCount = data.bounties.filter(b => b.status === 'BIDDING').length;
        const awardedCount = data.bounties.filter(b => b.status === 'AWARDED' || b.status === 'SETTLED').length;

        const openEl = document.getElementById('bounty-stat-open');
        const biddingEl = document.getElementById('bounty-stat-bidding');
        const awardedEl = document.getElementById('bounty-stat-awarded');

        if (openEl) openEl.textContent = openCount;
        if (biddingEl) biddingEl.textContent = biddingCount;
        if (awardedEl) awardedEl.textContent = awardedCount;
      }
    } catch {}
  }

  async function loadRedBlueUI() {
    try {
      const res = await fetch('/api/verify/red-blue');
      const data = await res.json();
      if (data.ok && data.sessions && data.sessions.length > 0) {
        const s = data.sessions[0];
        const titleEl = document.getElementById('redblue-task-title');
        const statusEl = document.getElementById('redblue-status-tag');
        const roundEl = document.getElementById('redblue-round-indicator');
        const genEl = document.getElementById('redblue-generator-dog');
        const verEl = document.getElementById('redblue-verifier-dog');

        if (titleEl) titleEl.textContent = s.task_title;
        if (statusEl) {
          statusEl.textContent = s.status;
          statusEl.className = 'redblue-status-tag ' + (s.status === 'PASSED' ? 'passed' : (s.status === 'FAILED_CIRCUIT_BREAKER' ? 'failed' : 'active'));
        }
        if (roundEl) roundEl.textContent = '第 ' + s.current_round + ' 轮 (上限 ' + s.max_retries + ' 轮)';
        if (genEl) genEl.textContent = s.generator_dog;
        if (verEl) verEl.textContent = s.verifier_dog;
      }
    } catch {}
  }

  async function loadPipelinesUI() {
    try {
      const res = await fetch('/api/pipelines');
      const data = await res.json();
      if (data.ok && data.pipelines && data.pipelines.length > 0) {
        const pipe = data.pipelines[0];
        const titleEl = document.getElementById('pipeline-task-title');
        const statusEl = document.getElementById('pipeline-status-tag');
        const stageNameEl = document.getElementById('pipeline-current-stage-name');
        const spentEl = document.getElementById('pipeline-spent-budget');

        if (titleEl) titleEl.textContent = pipe.task_title;
        if (statusEl) {
          statusEl.textContent = pipe.status;
          statusEl.className = 'pipeline-status-tag ' + (pipe.status === 'COMPLETED' ? 'completed' : 'active');
        }
        if (stageNameEl && pipe.stages[pipe.current_stage_index]) {
          stageNameEl.textContent = pipe.stages[pipe.current_stage_index].name;
        }
        if (spentEl) spentEl.textContent = '$' + pipe.spent_budget_usd.toFixed(2);
      }
    } catch {}
  }

  async function fetchRecommendedPair() {
    const input = document.getElementById('chat-input');
    const topic = (input && input.value.trim()) || '通用架构设计辩论';
    try {
      // GOAL-067（P1-11）：补 x-mush-caller-auth 头（强制鉴权下裸 fetch 必 401 静默失效）。
      const authMeta = document.querySelector('meta[name="mush-caller-auth"]');
      const authVal = authMeta ? (authMeta.getAttribute('content') || '') : '';
      const res = await fetch('/api/collaboration/recommend-pair', {
        method: 'POST',
        headers: Object.assign(
          { 'content-type': 'application/json' },
          authVal ? { 'x-mush-caller-auth': authVal } : {}
        ),
        body: JSON.stringify({ topic, mode: currentCollabMode })
      });
      const data = await res.json();
      if (data.ok) {
        const pDog = document.getElementById('indicator-primary-dog');
        const oDog = document.getElementById('indicator-opposing-dog');
        const pCol = document.getElementById('pro-dog-name');
        const cCol = document.getElementById('con-dog-name');
        if (pDog) pDog.textContent = data.primaryDog;
        if (oDog) oDog.textContent = data.opposingDog;
        if (pCol) pCol.textContent = data.primaryDog;
        if (cCol) cCol.textContent = data.opposingDog;
      }
    } catch {}
  }

  async function submitArbitration(chosenPlan) {
    if (!activeDebateId) return;
    const authMeta = document.querySelector('meta[name="mush-caller-auth"]');
    const callerAuth = authMeta ? authMeta.getAttribute('content') : '';

    try {
      const res = await fetch('/api/debates/' + activeDebateId + '/arbitrate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mush-caller-auth': callerAuth || ''
        },
        body: JSON.stringify({ chosen_plan: chosenPlan, notes: '人类终审裁决' })
      });
      const data = await res.json();
      if (data.ok) {
        const tag = document.getElementById('debate-status-tag');
        if (tag) {
          tag.textContent = 'SETTLED (' + chosenPlan + ')';
          tag.className = 'debate-status-tag settled';
        }
        activeDebateId = null;
        setArbitrationButtonsEnabled(false);
      }
    } catch {}
  }

  // GOAL-067（P2-14，F3 折中）：辩论仲裁按钮此前是死按钮——activeDebateId 恒
  // 为 null 且无任何代码赋值。现接通 GET /api/debates 真实引擎数据。
  function setArbitrationButtonsEnabled(enabled) {
    ['btn-arbitrate-pro', 'btn-arbitrate-con', 'btn-arbitrate-merge'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.disabled = !enabled;
    });
  }

  async function loadDebatesUI() {
    try {
      const res = await fetch('/api/debates');
      const data = await res.json();
      if (data.ok && Array.isArray(data.debates)) {
        const active = data.debates.find(function (d) { return d.status === 'ACTIVE'; });
        activeDebateId = active ? active.debate_id : null;
        const tag = document.getElementById('debate-status-tag');
        if (tag) {
          if (active) {
            tag.textContent = 'ACTIVE · ' + (active.topic || active.debate_id || '');
            document.getElementById('debate-topic-display').textContent = active.topic || '';
          } else {
            tag.textContent = '暂无进行中的圆桌辩论';
          }
        }
        setArbitrationButtonsEnabled(activeDebateId !== null);
        // GOAL-067（P2-14，F3）：共识/分歧清单接真实引擎提炼结果（空态保持占位）。
        if (active) {
          const conList = document.getElementById('debate-consensus-list');
          const disList = document.getElementById('debate-disputes-list');
          if (conList) {
            conList.innerHTML = (Array.isArray(active.consensus) && active.consensus.length > 0)
              ? active.consensus.map(function (c) { return '<li>' + esc(String(c)) + '</li>'; }).join('')
              : '<li>暂无提纯共识</li>';
          }
          if (disList) {
            disList.innerHTML = (Array.isArray(active.disputes) && active.disputes.length > 0)
              ? active.disputes.map(function (c) { return '<li>' + esc(String(c)) + '</li>'; }).join('')
              : '<li>暂无分歧点</li>';
          }
        }
      }
    } catch {}
  }

  async function autoMatchBestBid() {
    const authMeta = document.querySelector('meta[name="mush-caller-auth"]');
    const callerAuth = authMeta ? authMeta.getAttribute('content') : '';
    const headers = { 'content-type': 'application/json', 'x-mush-caller-auth': callerAuth || '' };
    try {
      // GOAL-067（P2-14，F3）：自动撮合按钮此前永久隐藏且 handler 只会刷新列表。
      // 现接通真实引擎：取最新 BIDDING 悬赏 → 全员犬只自动出价 → 撮合最优标授予。
      const res = await fetch('/api/bounties');
      const data = await res.json();
      const bidding = data && data.bounties
        ? data.bounties.find(function (b) { return b.status === 'BIDDING'; }) ||
          data.bounties.find(function (b) { return b.status === 'OPEN'; })
        : null;
      if (!bidding) {
        if (typeof toast === 'function') toast('当前没有可撮合的悬赏任务', false);
        loadBountiesUI();
        return;
      }
      await fetch('/api/bounties/' + bidding.bounty_id + '/auto-bid', { method: 'POST', headers: headers, body: '{}' });
      const awardRes = await fetch('/api/bounties/' + bidding.bounty_id + '/award', { method: 'POST', headers: headers, body: '{}' });
      const awardData = await awardRes.json();
      if (awardData.ok) {
        const winner = awardData.bounty && awardData.bounty.awarded_bid ? awardData.bounty.awarded_bid.dog_id : '';
        if (typeof toast === 'function') toast('已自动撮合：' + bidding.title + ' → ' + winner, true);
      } else if (typeof toast === 'function') {
        toast('撮合失败：' + (awardData.error || '未知错误'), false);
      }
      loadBountiesUI();
    } catch {}
  }

  function initVelocityUI() {
    const btnExport = document.getElementById('btn-export-sled-report');
    if (!btnExport) return;

    btnExport.addEventListener('click', async () => {
      btnExport.disabled = true;
      btnExport.textContent = '生成中…';
      const authMeta = document.querySelector('meta[name="mush-caller-auth"]');
      const callerAuth = authMeta ? authMeta.getAttribute('content') : '';

      try {
        const res = await fetch('/api/velocity/report', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-mush-caller-auth': callerAuth || ''
          },
          body: JSON.stringify({ title: 'mush 多犬协作工程全景交付战报' })
        });
        const data = await res.json();
        if (data.ok && data.report && data.report.markdown) {
          const blob = new Blob([data.report.markdown], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'mush-sled-velocity-report.md';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          btnExport.textContent = '✅ 已导出';
          setTimeout(() => { btnExport.textContent = '📥 导出全景战报 (Markdown)'; btnExport.disabled = false; }, 1500);
        } else {
          alert('战报导出失败');
          btnExport.textContent = '📥 导出全景战报 (Markdown)';
          btnExport.disabled = false;
        }
      } catch (err) {
        alert('导出异常: ' + (err.message || err));
        btnExport.textContent = '📥 导出全景战报 (Markdown)';
        btnExport.disabled = false;
      }
    });
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initCollaborationUI();
      initVelocityUI();
      loadDebatesUI();
    });
  } else {
    initCollaborationUI();
    initVelocityUI();
    loadDebatesUI();
  }
`;
}
