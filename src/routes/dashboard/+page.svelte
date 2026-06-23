<script>
  import { onMount, onDestroy } from 'svelte';
  import { supabase } from '$lib/database/supabaseClient'; // 请根据你的实际路径修改

  let isLoading = $state(true);
  let userEmail = $state('');
  let authSubscription = $state(null);

  // 核心重定向函数
  function forceRedirectToLogin() {
    window.location.href = '/'; 
  }

  onMount(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        forceRedirectToLogin();
      } else {
        userEmail = session.user.email;
        isLoading = false;
      }
    });

    // 2. 实时监听：防止用户在另一个标签页登出，或者 Token 意外过期
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        forceRedirectToLogin();
      } else if (session) {
        userEmail = session.user.email;
        isLoading = false;
      }
    });
    
    authSubscription = data.subscription;
  });

  // 组件销毁时取消订阅，防止内存泄漏
  onDestroy(() => {
    if (authSubscription) {
      authSubscription.unsubscribe();
    }
  });

  // 退出登录
  async function handleSignOut() {
    await supabase.auth.signOut();
    // 登出后，上面的 onAuthStateChange 会捕获 'SIGNED_OUT' 事件并自动触发重定向
  }
</script>

<!-- 简单的 UI 占位，后续可替换为你设计好的 UI -->
{#if isLoading}
  <div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
    <p>正在验证灵魂契约...</p>
  </div>
{:else}
  <div style="padding: 2rem; font-family: sans-serif;">
    <h1>符文档案 - 核心控制区 (Dashboard)</h1>
    <p>欢迎回来, <strong>{userEmail}</strong></p>
    
    <hr style="margin: 2rem 0; border-color: #eee;" />
    
    <p>这里是你未来的数据面板、卡牌库和 QA 区域...</p>
    
    <button 
      on:click={handleSignOut} 
      style="margin-top: 2rem; padding: 0.8rem 1.5rem; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1rem;"
    >
      解除契约 (退出登录)
    </button>
  </div>
{/if}