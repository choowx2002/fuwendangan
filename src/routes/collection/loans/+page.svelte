<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { Plus, Trash2, Users, Check, Undo2, TriangleAlert } from '@lucide/svelte'
  import {
    getLoans,
    createLoan,
    updateLoan,
    deleteLoan,
    getContacts,
    createContact,
    deleteContact,
    PRESET_LANGUAGE_CODES,
    printCacheName,
    type CardLoanWithName,
    type Contact,
    type LoanDirection,
    type LoanStatus,
  } from '$lib/db'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { confirmAction } from '$lib/utils/confirm'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import VariantPicker from '$lib/components/collection/VariantPicker.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import EmptyState from '$lib/components/collection/EmptyState.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  type Finish = 'any' | 'normal' | 'foil'

  let direction = $state<LoanDirection>('out')
  let loans = $state<CardLoanWithName[]>([])
  let contacts = $state<Contact[]>([])
  let loading = $state(true)

  let showAdd = $state(false)
  let showPicker = $state(false)
  let showContacts = $state(false)
  let newContactInput = $state('')
  let saving = $state(false)

  let form = $state({
    contactId: '',
    newContactName: '',
    cardNo: '',
    cardNoExtend: '',
    cardName: '',
    languageCode: '*',
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
    } finally {
      loading = false
    }
  }

  function openAdd() {
    form = {
      contactId: '',
      newContactName: '',
      cardNo: '',
      cardNoExtend: '',
      cardName: '',
      languageCode: '*',
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
      showAdd = false
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
    <button class="tab" class:active={direction === 'out'} onclick={() => { direction = 'out'; void load() }}>
      {$t('loans.tab.out')}
    </button>
    <button class="tab" class:active={direction === 'in'} onclick={() => { direction = 'in'; void load() }}>
      {$t('loans.tab.in')}
    </button>
  </div>

  {#if loading && loans.length === 0}
    <div class="loading-tip">{$t('common.loading')}</div>
  {:else if loans.length === 0}
    <EmptyState
      title={$t('loans.emptyTitle')}
      description={$t('loans.emptyDesc')}
      actionLabel={$t('loans.add')}
      onAction={openAdd}
    />
  {:else}
    <div class="list">
      {#each loans as loan (loan.id)}
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
              <span class="badge badge-{loan.status}">{statusLabel(loan.status, loan.direction)}</span>
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
              {#if loan.language_code !== '*'}
                <span class="meta-item">{loan.language_code}</span>
              {/if}
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
            <button
              class="icon-btn danger"
              title={$t('common.delete')}
              onclick={() => remove(loan)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<CommonModal
  open={showAdd}
  title={$t('loans.add')}
  subtitle={form.cardNoExtend ? `${form.cardName} · ${form.cardNoExtend}` : ''}
  onclose={() => (showAdd = false)}
>
  <div class="form">
    <div class="field">
      <label class="label" for="loan-card">{$t('loans.card')}</label>
      <button class="card-pick" id="loan-card" onclick={() => (showPicker = true)}>
        {form.cardNoExtend
          ? `${form.cardName || form.cardNo} · ${form.cardNoExtend}`
          : $t('wishlist.pickCardHint')}
      </button>
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
          <option value="*">{$t('wishlist.anyLang')}</option>
          {#each PRESET_LANGUAGE_CODES as code (code)}
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
          <span class="contact-name">{c.name}</span>
          {#if c.note}
            <span class="contact-note">{c.note}</span>
          {/if}
          <button
            class="icon-btn danger"
            title={$t('common.delete')}
            onclick={() => removeContact(c)}
          >
            <Trash2 size={15} />
          </button>
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
        {$t('loans.addContact')}
      </button>
    </div>
  </div>
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

  .contacts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .contact-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
  }

  .contact-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .contact-note {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
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
</style>
