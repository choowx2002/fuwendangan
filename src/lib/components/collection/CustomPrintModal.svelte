<script lang="ts">
  import type { CardPrint } from '$lib/db'
  import {
    createCustomPrint,
    updateCustomPrint,
    updateCustomPrintImg,
    getCustomLanguages,
    getCardById,
    getPrintsByCardId,
    searchCards,
  } from '$lib/db'
  import { PRESET_LANGUAGE_CODES, languageDisplayName } from '$lib/db'
  import { X, Search } from '@lucide/svelte'
  import { open } from '@tauri-apps/plugin-dialog'
  import { copyImageIntoCache, deleteCachedImage } from '$lib/services/db-file-service'
  import {
    loadImageFromAppFolder,
    localImgToken,
    saveRemoteImageAsToken,
  } from '$lib/services/image-cache-service'
  import { showToast } from '$lib/stores/ui-store.svelte'

  interface Props {
    cardId: string
    cardNo: string
    editPrint: CardPrint | null
    isOpen: boolean
    onClose: () => void
    onSaved: (printId: string) => void
  }

  // 自定义打印参与编辑（editPrint != null 时修改现有打印）
  let { cardId, cardNo, editPrint, isOpen, onClose, onSaved }: Props = $props()

  let cardNoExtend = $state('')
  let extendRarityName = $state('平卡')
  let language = $state('SC')
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])
  let customLangNames = $state(new Map<string, string>())
  let artist = $state('')
  let imgToken = $state<string | null>(null)
  let imgUrl = $state('')
  let imgApplying = $state(false)
  let previewUrl = $state<string | null>(null)
  let normalQty = $state(1)
  let foilQty = $state(0)
  let saving = $state(false)
  let errorMsg = $state('')
  let variantConflict = $state('')
  // 编辑时原始卡图 token（保存后用于清理被替换的旧缓存文件）
  let originalImgToken = $state<string | null>(null)

  // 原型卡（Base）：自定义打印挂载的目标卡牌，卡组持有检测按它聚合
  let baseCard = $state<{ id: string; cardNo: string; name: string } | null>(null)
  let baseCardError = $state('')
  let showCardSearch = $state(false)
  let cardSearchText = $state('')
  let cardSearchResults = $state<{ id: string; card_no: string; name: string }[]>([])
  let cardSearching = $state(false)
  let cardSearchError = $state('')

  const RARITY_OPTIONS = ['平卡', '异画', '超编', '签名超编']

  async function prefillBase(id: string) {
    baseCard = null
    baseCardError = ''
    if (!id) return
    try {
      const c = await getCardById(id)
      if (!c) {
        baseCardError = '未找到原型卡'
        return
      }
      baseCard = { id: c.id, cardNo: c.card_no ?? '', name: c.card_name_cn ?? c.card_name_en ?? '' }
    } catch (err) {
      console.error('[CustomPrintModal] 原型卡加载失败:', err)
      baseCardError = '原型卡加载失败'
    }
  }

  async function searchBaseCards() {
    const text = cardSearchText.trim()
    if (!text) return
    cardSearching = true
    cardSearchError = ''
    try {
      const res = await searchCards({ page: 1, pageSize: 8, searchText: text, is_banned: false })
      cardSearchResults = res.data.map((c) => ({
        id: c.id,
        card_no: c.card_no,
        name: c.card_name_cn ?? c.card_name_en ?? '',
      }))
    } catch (err) {
      console.error('[CustomPrintModal] 原型卡搜索失败:', err)
      cardSearchResults = []
      cardSearchError = '搜索失败，请重试'
    } finally {
      cardSearching = false
    }
  }

  function selectBaseCard(c: { id: string; card_no: string; name: string }) {
    baseCard = { id: c.id, cardNo: c.card_no, name: c.name }
    showCardSearch = false
    cardSearchText = ''
    cardSearchResults = []
  }

  $effect(() => {
    if (!isOpen) return
    errorMsg = ''
    saving = false
    baseCardError = ''
    cardSearchError = ''
    if (editPrint) {
      cardNoExtend = editPrint.card_no_extend ?? ''
      extendRarityName = editPrint.extend_rarity_name ?? '平卡'
      language = editPrint.language ?? ''
      artist = editPrint.artist ?? ''
      imgToken = localImgToken(editPrint.img_cdn)
      originalImgToken = imgToken
      normalQty = 0
      foilQty = 0
      void prefillBase(editPrint.card_id ?? '')
    } else {
      cardNoExtend = ''
      extendRarityName = '平卡'
      language = 'SC'
      artist = ''
      imgToken = null
      originalImgToken = null
      normalQty = 1
      foilQty = 0
      void prefillBase(cardId)
    }
    showCardSearch = false
    cardSearchText = ''
    cardSearchResults = []
    imgUrl = ''
    imgApplying = false
    void loadLangOptions()
  })

  // 预览图：local:// token → blob URL（local:// 不是 WebView 注册协议，不能直接当 img src）
  $effect(() => {
    const token = imgToken
    if (!token) {
      previewUrl = null
      return
    }
    let url: string | null = null
    let active = true
    void loadImageFromAppFolder(`local://${token}`, 'custom').then((u) => {
      if (active && u) {
        url = u
        previewUrl = u
      }
    })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  })

  async function loadLangOptions() {
    const customs = await getCustomLanguages()
    customLangNames = new Map(customs.map((c) => [c.code, c.name]))
    const base = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    if (language && !base.includes(language)) base.push(language)
    langOptions = base
  }

  // 卡牌号实时校验：与原型卡已有印刷（含语言）冲突时阻止保存，保证自定打印成为独立卡牌
  async function checkVariantConflict(baseId: string, no: string, editId: string | null) {
    const prints = await getPrintsByCardId(baseId)
    const existing = prints.filter((p) => p.card_no_extend === no && p.id !== editId)
    variantConflict =
      existing.length > 0
        ? `该卡牌号已存在（已有语言：${[
            ...new Set(existing.map((p) => p.language ?? '未知')),
          ].join('、')}）`
        : ''
  }

  $effect(() => {
    if (!isOpen) return
    const no = cardNoExtend.trim()
    const baseId = baseCard?.id
    if (!baseId || !no) {
      variantConflict = ''
      return
    }
    void checkVariantConflict(baseId, no, editPrint?.id ?? null)
  })

  function clearError() {
    errorMsg = ''
  }

  async function pickImage() {
    const selected = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (typeof selected !== 'string' || !selected) return
    const token = `custom-${Date.now()}`
    const ok = await copyImageIntoCache(selected, token)
    if (ok) {
      imgToken = token
    } else {
      errorMsg = '图片复制失败'
    }
  }

  function removeImage() {
    if (!imgToken) return
    // 编辑时移除原始图不立即删文件（打印仍引用它，取消编辑时保留）；保存成功后统一清理
    if (!editPrint || imgToken !== originalImgToken) {
      void deleteCachedImage(imgToken)
    }
    imgToken = null
  }

  async function applyImgUrl() {
    const url = imgUrl.trim()
    if (!url) {
      errorMsg = '请输入图片 URL'
      return
    }
    if (!/^https?:\/\//i.test(url)) {
      errorMsg = 'URL 需以 http:// 或 https:// 开头'
      return
    }
    clearError()
    imgApplying = true
    try {
      const token = `custom-${Date.now()}`
      const ok = await saveRemoteImageAsToken(url, token)
      if (ok) {
        imgToken = token
        imgUrl = ''
      } else {
        errorMsg = '图片下载失败，请确认链接可访问'
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '图片下载失败'
    } finally {
      imgApplying = false
    }
  }

  async function save() {
    if (!cardNoExtend.trim()) {
      errorMsg = '请填写卡图编号'
      return
    }
    if (variantConflict) {
      errorMsg = variantConflict
      return
    }
    if (!editPrint && !baseCard) {
      errorMsg = '请先选择原型卡'
      showToast('请先选择原型卡', 'error')
      return
    }
    saving = true
    clearError()
    const pendingImgToken = imgToken
    try {
      let printId: string
      if (editPrint) {
        printId = editPrint.id
        await updateCustomPrint(printId, {
          card_no_extend: cardNoExtend.trim(),
          extend_rarity_name: extendRarityName,
          language: language.trim() || 'SC',
          artist: artist.trim() || null,
        })
        await updateCustomPrintImg(printId, imgToken)
      } else {
        printId = await createCustomPrint({
          cardId: baseCard?.id ?? cardId,
          cardNoExtend: cardNoExtend.trim(),
          extendRarityName,
          language: language.trim() || 'SC',
          artist: artist.trim() || null,
          imgToken,
          normalQty,
          foilQty,
        })
      }
      if (editPrint && originalImgToken && originalImgToken !== imgToken) {
        void deleteCachedImage(originalImgToken)
      }
      showToast(editPrint ? '自定打印已更新' : '自定打印已创建', 'success')
      onSaved(printId)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      errorMsg = msg
      showToast(msg, 'error')
      // 创建失败时清理本次已复制的卡图缓存，避免孤儿文件
      if (!editPrint && pendingImgToken) {
        void deleteCachedImage(pendingImgToken)
        imgToken = null
      }
    } finally {
      saving = false
    }
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="modal-content"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      oninput={clearError}
    >
      <button class="close-btn" onclick={onClose} aria-label="关闭">
        <X size={20} />
      </button>
      <h3 class="modal-title">
        {editPrint ? '编辑自定打印' : cardNo ? `新建自定打印（原型 ${cardNo}）` : '新建自定打印'}
      </h3>

      {#if editPrint}
        <div class="field">
          <span class="field-label">原型卡（Base）</span>
          <div class="base-card-row">
            <span class="base-card-info">
              {baseCard
                ? `${baseCard.cardNo} · ${baseCard.name}`
                : baseCardError
                  ? baseCardError
                  : '加载中...'}
            </span>
          </div>
        </div>
      {:else}
        <div class="field">
          <span class="field-label">原型卡（Base）</span>
          <div class="base-card-row">
            <span class="base-card-info">
              {baseCard
                ? `${baseCard.cardNo} · ${baseCard.name}`
                : baseCardError
                  ? baseCardError
                  : '尚未选择'}
            </span>
            <button
              class="btn-ghost"
              type="button"
              onclick={() => (showCardSearch = !showCardSearch)}
            >
              {showCardSearch ? '收起' : baseCard ? '更换' : '选择原型卡'}
            </button>
          </div>
          {#if showCardSearch}
            <div class="card-search-panel">
              <div class="card-search-row">
                <input
                  bind:value={cardSearchText}
                  placeholder="按卡号或卡名搜索"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void searchBaseCards()
                  }}
                />
                <button class="btn-ghost" type="button" onclick={() => void searchBaseCards()}>
                  <Search size={14} /> 搜索
                </button>
              </div>
              <div class="card-search-results">
                {#each cardSearchResults as r (r.id)}
                  <button class="card-search-item" type="button" onclick={() => selectBaseCard(r)}>
                    <span class="cs-no">{r.card_no}</span>
                    <span class="cs-name">{r.name}</span>
                  </button>
                {/each}
                {#if cardSearchError}
                  <div class="cs-empty">{cardSearchError}</div>
                {:else if cardSearching}
                  <div class="cs-empty">搜索中...</div>
                {:else if cardSearchText && cardSearchResults.length === 0}
                  <div class="cs-empty">未找到匹配卡牌</div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <div class="field">
        <label for="cp-extend">卡图编号（卡牌号）</label>
        <input
          id="cp-extend"
          bind:value={cardNoExtend}
          placeholder={baseCard?.cardNo ? `如 ${baseCard.cardNo}-C01` : '如 C01'}
        />
        {#if variantConflict}
          <small class="conflict-msg">{variantConflict}</small>
        {/if}
      </div>

      <div class="form-row">
        <div class="field">
          <label for="cp-rarity">扩展稀有度</label>
          <select id="cp-rarity" bind:value={extendRarityName}>
            {#each RARITY_OPTIONS as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label for="cp-lang">语言</label>
          <select id="cp-lang" bind:value={language}>
            {#each langOptions as code (code)}
              <option value={code}>{languageDisplayName(code, customLangNames)}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="cp-artist">画师（可选）</label>
        <input id="cp-artist" bind:value={artist} placeholder="画师名" />
      </div>

      <div class="field">
        <span class="field-label">卡图</span>
        {#if imgToken}
          <div class="img-row">
            <img
              src={previewUrl}
              alt="预览"
              class="img-preview"
              onerror={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
            <button class="btn-ghost" onclick={removeImage} type="button">移除</button>
          </div>
        {:else}
          <div class="img-source">
            <button class="btn-ghost" onclick={pickImage} type="button">选择本地图片</button>
            <span class="img-or">或</span>
            <div class="img-url-row">
              <input
                bind:value={imgUrl}
                placeholder="输入图片 URL（https://...）"
                onkeydown={(e) => {
                  if (e.key === 'Enter') void applyImgUrl()
                }}
              />
              <button
                class="btn-ghost"
                onclick={() => void applyImgUrl()}
                type="button"
                disabled={imgApplying}
              >
                {imgApplying ? '下载中...' : '应用'}
              </button>
            </div>
          </div>
        {/if}
        <small class="hint">不选则不显示卡图</small>
      </div>

      {#if !editPrint}
        <div class="qty-row">
          <div class="field inline">
            <label for="cp-normal">普卡</label>
            <input id="cp-normal" type="number" bind:value={normalQty} min="0" />
          </div>
          <div class="field inline">
            <label for="cp-foil">闪卡</label>
            <input id="cp-foil" type="number" bind:value={foilQty} min="0" />
          </div>
        </div>
      {/if}

      {#if errorMsg}
        <div class="error-msg">{errorMsg}</div>
      {/if}

      <div class="actions">
        <button class="btn-cancel" onclick={onClose} type="button">取消</button>
        <button class="btn-save" onclick={save} type="button" disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-content {
    width: 100%;
    max-width: 460px;
    max-height: 90vh;
    overflow-y: auto;
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 24px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .modal-title {
    margin: 0;
    color: var(--text-primary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field.inline {
    flex: 1;
  }

  .form-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .form-row .field {
    flex: 1;
    min-width: 160px;
  }

  .field label,
  .field .field-label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .field input,
  .field select {
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .qty-row {
    display: flex;
    gap: 12px;
  }

  .base-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .base-card-info {
    font-size: var(--text-sm);
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-search-panel {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-secondary);
  }

  .card-search-row {
    display: flex;
    gap: 8px;
  }

  .card-search-row input {
    flex: 1;
    min-width: 0;
  }

  .card-search-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  .card-search-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font-size: var(--text-sm);
  }

  .card-search-item:hover {
    background: var(--bg-hover);
  }

  .cs-no {
    font-weight: 600;
    color: var(--accent-color);
    flex-shrink: 0;
  }

  .cs-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cs-empty {
    padding: 8px 4px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
  }

  .img-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .img-source {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .img-or {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }

  .img-url-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 220px;
  }

  .img-url-row input {
    flex: 1;
    min-width: 0;
  }

  .img-preview {
    width: 72px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
  }

  .hint {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }

  .error-msg {
    color: #ef4444;
    font-size: var(--text-sm);
  }

  .conflict-msg {
    color: #ef4444;
    font-size: var(--text-xs);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }

  .btn-ghost {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .btn-cancel {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .btn-save {
    padding: 8px 20px;
    border: none;
    border-radius: 8px;
    background: var(--accent-color);
    color: #fff;
    cursor: pointer;
  }

  .btn-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
