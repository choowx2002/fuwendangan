<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import {
    Plus,
    Trash2,
    Users,
    Check,
    Undo2,
    TriangleAlert,
    Pencil,
    MessageCircle,
    MessageSquare,
    Phone,
    Mail,
    UserRoundPen,
    Download,
  } from '@lucide/svelte'
  import {
    getLoans,
    createLoan,
    updateLoan,
    deleteLoan,
    getContacts,
    createContact,
    updateContact,
    deleteContact,
    getCustomLanguages,
    PRESET_LANGUAGE_CODES,
    printCacheName,
    isTauri,
    type CardLoanWithName,
    type Contact,
    type ContactInput,
    type LoanDirection,
    type LoanStatus,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { defaultLanguage } from '$lib/stores/settings'
  import { confirmAction } from '$lib/utils/confirm'
  import { longpress } from '$lib/utils/longpress'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import VariantPicker from '$lib/components/collection/VariantPicker.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { saveTextFile } from '$lib/collection/collection-export'
  import { buildLoansCsv, buildContactsCsv } from '$lib/collection/loan-csv'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  type Finish = 'any' | 'normal' | 'foil'

  let direction = $state<LoanDirection>('out')
  let loans = $state<CardLoanWithName[]>([])
  let contacts = $state<Contact[]>([])
  let loading = $state(true)
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])

  let showAdd = $state(false)
  let editingId = $state<string | null>(null)
  let showPicker = $state(false)
  let showContacts = $state(false)
  let showExport = $state(false)
  let newContactInput = $state('')
  let saving = $state(false)
  let contactFilter = $state('')

  let form = $state({
    contactId: '',
    newContactName: '',
    cardNo: '',
    cardNoExtend: '',
    cardName: '',
    languageCode: get(defaultLanguage),
    finish: 'any' as Finish,
    qty: 1,
    loanedAt: '',
    dueAt: '',
    note: '',
  })

  function isoDate(date: string): string {
    return date ? new Date(date).toISOString() : ''
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  function displayDate(iso: string | null): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso.slice(0, 10)
    return d.toISOString().slice(0, 10)
  }

  function statusLabel(status: LoanStatus, direction: LoanDirection): string {
    if (direction === 'in' && (status === 'active' || status === 'overdue')) {
      return get(t)(`loans.status.in.${status}`)
    }
    return get(t)(`loans.status.${status}`)
  }

  function finishLabel(finish: string): string {
    if (finish === 'normal') return get(t)('loans.finish.normal')
    if (finish === 'foil') return get(t)('loans.finish.foil')
    return get(t)('loans.finish.any')
  }

  async function load() {
    loading = true
    try {
      const [loanRes, contactRes] = await Promise.all([getLoans({ direction }), getContacts()])
      loans = loanRes
      contacts = contactRes
      const customs = await getCustomLanguages()
      langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    } finally {
      loading = false
    }
  }

  const DUE_SOON_DAYS = 3

  const filteredLoans = $derived(
    contactFilter === ''
      ? loans
      : loans.filter((l) =>
          contactFilter === 'none' ? !l.contact_id : l.contact_id === contactFilter
        )
  )

  const summary = $derived.by(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const todayISO = new Date(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    ).toISOString()
    const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    const tomorrowISO = new Date(
      `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
    ).toISOString()
    const soon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1 + DUE_SOON_DAYS)
    const soonISO = new Date(
      `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`
    ).toISOString()

    let active = 0
    let overdue = 0
    let dueToday = 0
    let dueSoon = 0
    for (const l of filteredLoans) {
      if (l.status === 'active') active++
      else if (l.status === 'overdue') overdue++
      if ((l.status === 'active' || l.status === 'overdue') && l.due_at) {
        if (l.due_at >= todayISO && l.due_at < tomorrowISO) dueToday++
        else if (l.due_at >= tomorrowISO && l.due_at < soonISO) dueSoon++
      }
    }
    return { active, overdue, dueToday, dueSoon }
  })

  const contactNameById = $derived(new Map(contacts.map((c) => [c.id, c.name])))

  async function exportLoansCsv() {
    if (filteredLoans.length === 0) {
      showToast(get(t)('loans.noDataToExport'), 'info')
      return
    }
    const rows = filteredLoans.map((l) => ({
      cardNoExtend: l.card_no_extend || l.card_no,
      cardName: l.card_name_cn || l.card_no,
      direction: get(t)(`loans.tab.${l.direction}`),
      contact: l.contact_id ? (contactNameById.get(l.contact_id) ?? '') : '',
      language: l.language_code,
      finish: finishLabel(l.finish),
      qty: l.qty,
      loanedAt: l.loaned_at ? new Date(l.loaned_at).toLocaleString() : '',
      dueAt: l.due_at ? new Date(l.due_at).toLocaleString() : '',
      returnedAt: l.returned_at ? new Date(l.returned_at).toLocaleString() : '',
      status: statusLabel(l.status, l.direction),
      note: l.note ?? '',
    }))
    const stamp = new Date().toISOString().slice(0, 10)
    const ok = await saveTextFile(buildLoansCsv(rows), `rune-archive-loans-${stamp}.csv`, {
      format: 'csv',
      title: get(t)('loans.exportLoans'),
    })
    if (ok) showToast(get(t)('loans.exported', { values: { count: rows.length } }), 'success')
    else showToast(get(t)('loans.exportCancelled'), 'info')
  }

  async function exportContactsCsv() {
    if (contacts.length === 0) {
      showToast(get(t)('loans.noDataToExport'), 'info')
      return
    }
    const rows = contacts.map((c) => ({
      name: c.name,
      wechat: c.wechat ?? '',
      qq: c.qq ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      note: c.note ?? '',
    }))
    const stamp = new Date().toISOString().slice(0, 10)
    const ok = await saveTextFile(buildContactsCsv(rows), `rune-archive-contacts-${stamp}.csv`, {
      format: 'csv',
      title: get(t)('loans.exportContacts'),
    })
    if (ok) showToast(get(t)('loans.exported', { values: { count: rows.length } }), 'success')
    else showToast(get(t)('loans.exportCancelled'), 'info')
  }

  function openAdd() {
    editingId = null
    form = {
      contactId: '',
      newContactName: '',
      cardNo: '',
      cardNoExtend: '',
      cardName: '',
      languageCode: get(defaultLanguage),
      finish: 'any',
      qty: 1,
      loanedAt: toLocalInput(new Date().toISOString()),
      dueAt: '',
      note: '',
    }
    showPicker = true
  }

  function pickCard(v: { cardNo: string; cardNoExtend: string; card_name_cn: string | null }) {
    form.cardNo = v.cardNo
    form.cardNoExtend = v.cardNoExtend
    form.cardName = v.card_name_cn ?? ''
    showPicker = false
    showAdd = true
  }

  function openEdit(loan: CardLoanWithName) {
    editingId = loan.id
    form = {
      contactId: loan.contact_id ?? '',
      newContactName: '',
      cardNo: loan.card_no,
      cardNoExtend: loan.card_no_extend,
      cardName: loan.card_name_cn ?? '',
      languageCode: loan.language_code,
      finish: loan.finish,
      qty: loan.qty,
      loanedAt: toLocalInput(loan.loaned_at),
      dueAt: loan.due_at ? toLocalInput(loan.due_at).slice(0, 10) : '',
      note: loan.note ?? '',
    }
    showAdd = true
  }

  async function submit() {
    if (!form.cardNoExtend || !form.loanedAt) return
    saving = true
    try {
      let contactId = form.contactId
      if (form.contactId === '__new__') {
        contactId = await createContact(
          form.newContactName.trim() || get(t)('loans.unnamedContact')
        )
        contacts = await getContacts()
      }
      if (editingId) {
        await updateLoan(editingId, {
          contactId: contactId || null,
          qty: Math.max(1, form.qty),
          languageCode: form.languageCode,
          finish: form.finish,
          loanedAt: isoDate(form.loanedAt),
          dueAt: form.dueAt ? isoDate(form.dueAt) : null,
          note: form.note.trim() || null,
        })
        showToast(get(t)('loans.updated'), 'success')
      } else {
        await createLoan({
          direction,
          contactId: contactId || null,
          cardNo: form.cardNo,
          cardNoExtend: form.cardNoExtend,
          languageCode: form.languageCode,
          finish: form.finish,
          qty: Math.max(1, form.qty),
          loanedAt: isoDate(form.loanedAt),
          dueAt: form.dueAt ? isoDate(form.dueAt) : null,
          note: form.note.trim() || null,
        })
        showToast(get(t)('loans.created'), 'success')
      }
      showAdd = false
      editingId = null
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      saving = false
    }
  }

  async function setStatus(loan: CardLoanWithName, status: LoanStatus) {
    await updateLoan(loan.id, { status })
    void load()
  }

  async function remove(loan: CardLoanWithName) {
    const confirmed = await confirmAction(
      get(t)('loans.deleteConfirm', {
        values: { card: loan.card_name_cn || loan.card_no_extend },
      }),
      {
        title: get(t)('loans.title'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirmed) return
    await deleteLoan(loan.id)
    showToast(get(t)('loans.deleted'), 'info')
    void load()
  }

  async function addContact() {
    const name = newContactInput.trim()
    if (!name) return
    await createContact(name)
    newContactInput = ''
    contacts = await getContacts()
    void load()
  }

  async function removeContact(contact: Contact) {
    const confirmed = await confirmAction(
      get(t)('loans.deleteContactConfirm', { values: { name: contact.name } }),
      {
        title: get(t)('loans.contacts'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirmed) return
    await deleteContact(contact.id)
    contacts = await getContacts()
    void load()
  }

  // ---------- 联系人信息拓展（微信/QQ/电话/邮箱） ----------
  type ContactField = 'wechat' | 'qq' | 'phone' | 'email'

  const CONTACT_FIELDS: { key: ContactField; labelKey: string; icon: typeof MessageCircle }[] = [
    { key: 'wechat', labelKey: 'loans.contactField.wechat', icon: MessageCircle },
    { key: 'qq', labelKey: 'loans.contactField.qq', icon: MessageSquare },
    { key: 'phone', labelKey: 'loans.contactField.phone', icon: Phone },
    { key: 'email', labelKey: 'loans.contactField.email', icon: Mail },
  ]

  function contactValue(c: Contact, f: ContactField): string | null {
    return c[f]
  }

  let longPressedAt = 0

  async function copyContactInfo(value: string) {
    try {
      if (isTauri) {
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
        await writeText(value)
      } else {
        await navigator.clipboard.writeText(value)
      }
      showToast(get(t)('loans.copyCopied'), 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    }
  }

  function contactDeepLink(c: Contact, f: ContactField): string {
    const v = contactValue(c, f)
    if (!v) return ''
    if (f === 'wechat') return `weixin://dl/chat?${encodeURIComponent(v)}`
    if (f === 'qq')
      return `mqqwpa://im/chat?chat_type=wpa&uin=${encodeURIComponent(v)}&version=1&src_type=web`
    if (f === 'phone') return `tel:${encodeURIComponent(v)}`
    return `mailto:${encodeURIComponent(v)}`
  }

  async function openContactLink(c: Contact, f: ContactField) {
    const url = contactDeepLink(c, f)
    if (!url) return
    longPressedAt = Date.now()
    try {
      if (isTauri) {
        await openUrl(url)
      } else {
        window.open(url, '_blank')
      }
    } catch {
      showToast(get(t)('loans.contactLinkFailed'), 'error')
    }
  }

  async function handleChipClick(c: Contact, f: ContactField) {
    // 长按刚触发过打开链接，忽略随后的 click，避免复制
    if (Date.now() - longPressedAt < 700) return
    const v = contactValue(c, f)
    if (v) await copyContactInfo(v)
  }

  // ---------- 联系人新增/编辑表单 ----------
  let showContactForm = $state(false)
  let editingContact = $state<Contact | null>(null)
  let contactForm = $state({ name: '', note: '', wechat: '', qq: '', phone: '', email: '' })
  let savingContact = $state(false)

  function openAddContact() {
    editingContact = null
    contactForm = {
      name: newContactInput.trim(),
      note: '',
      wechat: '',
      qq: '',
      phone: '',
      email: '',
    }
    showContactForm = true
  }

  function openEditContact(c: Contact) {
    editingContact = c
    contactForm = {
      name: c.name,
      note: c.note ?? '',
      wechat: c.wechat ?? '',
      qq: c.qq ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
    }
    showContactForm = true
  }

  async function submitContactForm() {
    if (savingContact || !contactForm.name.trim()) return
    savingContact = true
    try {
      const patch: ContactInput = {
        note: contactForm.note,
        wechat: contactForm.wechat,
        qq: contactForm.qq,
        phone: contactForm.phone,
        email: contactForm.email,
      }
      if (editingContact) {
        await updateContact(editingContact.id, { name: contactForm.name, ...patch })
        showToast(get(t)('loans.contactUpdated'), 'success')
      } else {
        await createContact(contactForm.name, patch)
        showToast(get(t)('loans.contactAdded'), 'success')
      }
      showContactForm = false
      contacts = await getContacts()
      void load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : get(t)('common.unknownError'), 'error')
    } finally {
      savingContact = false
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    setTopbar({
      title: $t('loans.title'),
      onBack: () => void goto('/collection'),
      actions: [
        {
          key: 'contacts',
          label: $t('loans.contacts'),
          icon: Users,
          title: $t('loans.contactsManage'),
          onClick: () => (showContacts = true),
        },
        {
          key: 'export',
          label: $t('loans.export'),
          icon: Download,
          title: $t('loans.export'),
          onClick: () => (showExport = true),
        },
        {
          key: 'add',
          label: $t('loans.add'),
          icon: Plus,
          onClick: openAdd,
          variant: 'primary',
        },
      ],
    })
  })
</script>

<div class="page">
  <div class="tab-row">
    <button
      class="tab"
      class:active={direction === 'out'}
      onclick={() => {
        direction = 'out'
        void load()
      }}
    >
      {$t('loans.tab.out')}
    </button>
    <button
      class="tab"
      class:active={direction === 'in'}
      onclick={() => {
        direction = 'in'
        void load()
      }}
    >
      {$t('loans.tab.in')}
    </button>
  </div>

  {#if loans.length > 0}
    <div class="filter-summary-row">
      <div class="summary-bar">
        <span class="summary-item"><b>{summary.active}</b> {$t('loans.sumActive')}</span>
        <span class="summary-item" class:summary-overdue={summary.overdue > 0}
          ><b>{summary.overdue}</b> {$t('loans.sumOverdue')}</span
        >
        <span class="summary-item" class:summary-due={summary.dueToday > 0}
          ><b>{summary.dueToday}</b> {$t('loans.sumDueToday')}</span
        >
        <span class="summary-item"
          ><b>{summary.dueSoon}</b>
          {$t('loans.sumDueSoon', { values: { days: DUE_SOON_DAYS } })}</span
        >
      </div>
      <select class="contact-filter" bind:value={contactFilter}>
        <option value="">{$t('loans.contactAll')}</option>
        <option value="none">{$t('loans.contactUnspecified')}</option>
        {#each contacts as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </div>
  {/if}

  {#if loading && loans.length === 0}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if loans.length === 0}
    <EmptyState
      title={$t('loans.emptyTitle')}
      description={$t('loans.emptyDesc')}
      actionLabel={$t('loans.add')}
      onAction={openAdd}
    />
  {:else if filteredLoans.length === 0}
    <div class="loading-tip">{$t('loans.noFilterMatch')}</div>
  {:else}
    <div class="list">
      {#each filteredLoans as loan (loan.id)}
        <div class="row">
          <CardSimpleImage
            url={loan.img_cdn}
            name={printCacheName({ card_no_extend: loan.card_no_extend, language: loan.img_lang })}
            className="row-thumb"
          />
          <div class="row-main">
            <div class="row-title">
              <span class="row-name">{loan.card_name_cn || loan.card_no}</span>
              <span class="row-extend">{loan.card_no_extend}</span>
              <span class="badge badge-{loan.status}"
                >{statusLabel(loan.status, loan.direction)}</span
              >
            </div>
            <div class="row-meta">
              <span class="meta-item">
                {direction === 'out' ? $t('loans.to') : $t('loans.from')}
                <b
                  >{loan.contact_id
                    ? (contacts.find((c) => c.id === loan.contact_id)?.name ?? '?')
                    : $t('loans.noContact')}</b
                >
              </span>
              <span class="meta-item">{$t('loans.qty')} × {loan.qty}</span>
              {#if loan.finish !== 'any'}
                <span class="meta-item">{finishLabel(loan.finish)}</span>
              {/if}
              <span class="meta-item">{$t('loans.loanedAt')} {displayDate(loan.loaned_at)}</span>
              {#if loan.due_at}
                <span class="meta-item">{$t('loans.dueAt')} {displayDate(loan.due_at)}</span>
              {/if}
              {#if loan.returned_at}
                <span class="meta-item"
                  >{$t('loans.returnedAt')} {displayDate(loan.returned_at)}</span
                >
              {/if}
              {#if loan.note}
                <span class="note">{loan.note}</span>
              {/if}
            </div>
          </div>
          <div class="row-actions">
            {#if loan.status === 'active' || loan.status === 'overdue'}
              <button
                class="icon-btn"
                title={$t('loans.return')}
                onclick={() => setStatus(loan, 'returned')}
              >
                <Check size={16} />
              </button>
              <button
                class="icon-btn"
                title={$t('loans.markLost')}
                onclick={() => setStatus(loan, 'lost')}
              >
                <TriangleAlert size={16} />
              </button>
              <button
                class="icon-btn"
                title={$t('loans.cancel')}
                onclick={() => setStatus(loan, 'cancelled')}
              >
                <Undo2 size={16} />
              </button>
            {:else}
              <button
                class="icon-btn"
                title={$t('loans.reactivate')}
                onclick={() => setStatus(loan, 'active')}
              >
                <Undo2 size={16} />
              </button>
            {/if}
            <button class="icon-btn" title={$t('loans.edit')} onclick={() => openEdit(loan)}>
              <Pencil size={16} />
            </button>
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={() => remove(loan)}
            >
              <Trash2 size={16} color={'red'} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<CommonModal
  open={showAdd}
  title={editingId ? $t('loans.edit') : $t('loans.add')}
  subtitle={form.cardNoExtend ? `${form.cardName} · ${form.cardNoExtend}` : ''}
  onclose={() => {
    showAdd = false
    editingId = null
  }}
>
  <div class="form">
    <div class="field">
      <label class="label" for="loan-card">{$t('loans.card')}</label>
      {#if editingId}
        <div class="card-fixed">
          {form.cardName || form.cardNo} · {form.cardNoExtend}
        </div>
      {:else}
        <button class="card-pick" id="loan-card" onclick={() => (showPicker = true)}>
          {form.cardNoExtend
            ? `${form.cardName || form.cardNo} · ${form.cardNoExtend}`
            : $t('wishlist.pickCardHint')}
        </button>
      {/if}
    </div>
    <div class="field">
      <label class="label" for="loan-contact">{$t('loans.contact')}</label>
      <select class="select" id="loan-contact" bind:value={form.contactId}>
        <option value="">{$t('loans.noContact')}</option>
        {#each contacts as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
        <option value="__new__">{$t('loans.newContact')}</option>
      </select>
      {#if form.contactId === '__new__'}
        <input
          class="input"
          id="loan-new-contact"
          placeholder={get(t)('loans.contactName')}
          bind:value={form.newContactName}
        />
      {/if}
    </div>
    <div class="form-row">
      <div class="field">
        <label class="label" for="loan-qty">{$t('loans.qty')}</label>
        <input class="input" id="loan-qty" type="number" min="1" bind:value={form.qty} />
      </div>
      <div class="field">
        <label class="label" for="loan-lang">{$t('wishlist.language')}</label>
        <select class="select" id="loan-lang" bind:value={form.languageCode}>
          {#each langOptions as code (code)}
            <option value={code}>{code}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label class="label" for="loan-finish">{$t('wishlist.finish')}</label>
        <select class="select" id="loan-finish" bind:value={form.finish}>
          <option value="any">{$t('loans.finish.any')}</option>
          <option value="normal">{$t('loans.finish.normal')}</option>
          <option value="foil">{$t('loans.finish.foil')}</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <label class="label" for="loan-loaned-at">{$t('loans.loanedAt')}</label>
        <input class="input" id="loan-loaned-at" type="datetime-local" bind:value={form.loanedAt} />
      </div>
      <div class="field">
        <label class="label" for="loan-due-at">{$t('loans.dueAt')}</label>
        <input class="input" id="loan-due-at" type="date" bind:value={form.dueAt} />
      </div>
    </div>
    <div class="field">
      <label class="label" for="loan-note">{$t('common.note')}</label>
      <input
        class="input"
        id="loan-note"
        bind:value={form.note}
        placeholder={$t('common.optional')}
      />
    </div>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showAdd = false)}>
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={saving || !form.cardNoExtend} onclick={submit}>
      {saving ? $t('common.saving') : $t('common.save')}
    </button>
  {/snippet}
</CommonModal>

<VariantPicker
  open={showPicker}
  ownedOnly={direction === 'out'}
  onClose={() => (showPicker = false)}
  onSelect={pickCard}
/>

<CommonModal
  open={showContacts}
  title={$t('loans.contacts')}
  onclose={() => (showContacts = false)}
>
  <div class="contacts">
    {#if contacts.length === 0}
      <div class="contacts-empty">{$t('loans.noContacts')}</div>
    {:else}
      {#each contacts as c (c.id)}
        <div class="contact-row">
          <div class="contact-main">
            <span class="contact-name">{c.name}</span>
            {#if c.note}
              <span class="contact-note">{c.note}</span>
            {/if}
            <div class="contact-info">
              {#each CONTACT_FIELDS as f (f.key)}
                {@const v = contactValue(c, f.key)}
                {#if v}
                  <button
                    type="button"
                    class="contact-chip"
                    use:longpress={{
                      duration: 500,
                      onLongPress: () => void openContactLink(c, f.key),
                    }}
                    onclick={() => handleChipClick(c, f.key)}
                    oncontextmenu={(e) => {
                      e.preventDefault()
                      void openContactLink(c, f.key)
                    }}
                    title={$t('loans.contactChipTitle')}
                  >
                    <f.icon size={12} />
                    {v}
                  </button>
                {/if}
              {/each}
            </div>
          </div>
          <div class="contact-actions">
            <button class="icon-btn" title={$t('common.edit')} onclick={() => openEditContact(c)}>
              <Pencil size={15} />
            </button>
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={() => removeContact(c)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      {/each}
    {/if}
    <div class="contact-add">
      <input
        class="input"
        placeholder={get(t)('loans.contactName')}
        bind:value={newContactInput}
        onkeydown={(e) => {
          if (e.key === 'Enter') void addContact()
        }}
      />
      <button class="button button-primary" onclick={addContact}>
        <Plus size={15} />
        {$t('loans.quickAdd')}
      </button>
      <button
        class="button button-ghost"
        onclick={openAddContact}
        title={$t('loans.addContactFull')}
      >
        <UserRoundPen size={14} />
      </button>
    </div>
  </div>
</CommonModal>

<CommonModal
  open={showContactForm}
  title={editingContact ? $t('loans.editContact') : $t('loans.addContactFull')}
  subtitle={editingContact ? editingContact.name : ''}
  onclose={() => (showContactForm = false)}
>
  <div class="form">
    <div class="field">
      <label class="label" for="cf-name">{$t('loans.contactName')}</label>
      <input
        class="input"
        id="cf-name"
        bind:value={contactForm.name}
        placeholder={get(t)('loans.contactName')}
      />
    </div>
    <div class="field">
      <label class="label" for="cf-note">{$t('common.note')}</label>
      <input
        class="input"
        id="cf-note"
        bind:value={contactForm.note}
        placeholder={get(t)('common.optional')}
      />
    </div>
    <div class="field">
      <label class="label" for="cf-wechat">{$t('loans.contactField.wechat')}</label>
      <input
        class="input"
        id="cf-wechat"
        bind:value={contactForm.wechat}
        placeholder={get(t)('loans.contactFieldPlaceholder')}
      />
    </div>
    <div class="field">
      <label class="label" for="cf-qq">{$t('loans.contactField.qq')}</label>
      <input
        class="input"
        id="cf-qq"
        bind:value={contactForm.qq}
        placeholder={get(t)('loans.contactFieldPlaceholder')}
      />
    </div>
    <div class="form-row">
      <div class="field">
        <label class="label" for="cf-phone">{$t('loans.contactField.phone')}</label>
        <input
          class="input"
          id="cf-phone"
          bind:value={contactForm.phone}
          placeholder={get(t)('loans.contactFieldPlaceholder')}
        />
      </div>
      <div class="field">
        <label class="label" for="cf-email">{$t('loans.contactField.email')}</label>
        <input
          class="input"
          id="cf-email"
          bind:value={contactForm.email}
          placeholder={get(t)('loans.contactFieldPlaceholder')}
        />
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showContactForm = false)}>
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={savingContact || !contactForm.name.trim()}
      onclick={submitContactForm}
    >
      {savingContact ? $t('common.saving') : $t('common.save')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal open={showExport} title={$t('loans.export')} onclose={() => (showExport = false)}>
  <div class="export-options">
    <button class="export-option" onclick={() => void exportLoansCsv()}>
      <Download size={18} />
      <div class="export-option-main">
        <span class="export-option-title">{$t('loans.exportLoans')}</span>
        <span class="export-option-desc">{$t('loans.exportLoansDesc')}</span>
      </div>
    </button>
    <button class="export-option" onclick={() => void exportContactsCsv()}>
      <Users size={18} />
      <div class="export-option-main">
        <span class="export-option-title">{$t('loans.exportContacts')}</span>
        <span class="export-option-desc">{$t('loans.exportContactsDesc')}</span>
      </div>
    </button>
  </div>
  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showExport = false)}>
      {$t('common.cancel')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
  }

  .tab-row {
    display: flex;
    gap: 8px;
    padding: 12px 16px 0;
    flex-shrink: 0;
  }

  .tab {
    padding: 6px 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .tab.active {
    background: var(--bg-active);
    color: var(--text-primary);
    font-weight: 500;
  }

  .summary-bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .filter-summary-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 16px 0;
    flex-wrap: wrap;
  }

  .contact-filter {
    /* margin-top: 10px;
    margin-right: 16px; */
    margin-left: auto;
    padding: 5px 8px;
    font-size: var(--text-xs);
    font-family: inherit;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    max-width: 160px;
  }

  .summary-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
  }

  .summary-item b {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .summary-overdue b,
  .summary-overdue {
    color: #d97706;
  }

  .summary-due b,
  .summary-due {
    color: #e5484d;
  }

  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 8px;
    padding: 12px 16px 24px;
  }
  @media (max-width: 767.99px) {
    .list {
      display: flex;
      flex-direction: column;
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    flex-wrap: wrap;
    background: var(--bg-secondary);
  }

  :global(.row-thumb) {
    width: 56px;
    height: 78px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  .row-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row-title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .row-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .row-extend {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-family: monospace;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--text-xs);
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .badge-active {
    color: #0e8a3e;
    background: rgba(14, 138, 62, 0.12);
  }

  .badge-overdue {
    color: #d97706;
    background: rgba(217, 119, 6, 0.14);
  }

  .badge-returned,
  .badge-cancelled {
    opacity: 0.65;
  }

  .badge-lost {
    color: #e5484d;
    background: rgba(229, 72, 77, 0.12);
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .note {
    color: var(--text-tertiary);
  }

  .row-actions {
    display: flex;
    gap: 4px;
    flex: 1 1 100%;
    justify-content: end;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.danger:hover {
    color: #e5484d;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .form-row .field {
    flex: 1;
    min-width: 120px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .input,
  .select {
    padding: 9px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .card-pick {
    padding: 10px 12px;
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .card-pick:hover {
    border-color: var(--text-tertiary);
  }

  .card-fixed {
    padding: 10px 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .contacts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .contact-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .contact-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .contact-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .contact-note {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .contact-info {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .contact-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    font-size: var(--text-xs);
    border-radius: 999px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    transition: background 0.15s;
  }

  .contact-chip:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .contact-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .contact-row .icon-btn {
    margin-left: auto;
  }

  .contacts-empty {
    padding: 24px 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .contact-add {
    display: flex;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  .contact-add .input {
    flex: 1;
  }

  .loading-tip {
    padding: 40px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .export-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .export-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .export-option:hover {
    border-color: var(--text-tertiary);
    background: var(--bg-hover);
  }

  .export-option-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .export-option-title {
    font-size: var(--text-base);
    font-weight: 500;
  }

  .export-option-desc {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
</style>
