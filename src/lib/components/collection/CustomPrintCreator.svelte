<script lang="ts">
  import CustomPrintModal from './CustomPrintModal.svelte'

  interface Props {
    isOpen: boolean
    onClose: () => void
    onSaved: (printId: string) => void
  }

  // 独立新建入口：无预填原型卡，用户在弹窗内搜索选择原型卡后创建自定打印
  let { isOpen, onClose, onSaved }: Props = $props()
</script>

<CustomPrintModal
  cardId=""
  cardNo=""
  editPrint={null}
  {isOpen}
  {onClose}
  {onSaved}
/>
