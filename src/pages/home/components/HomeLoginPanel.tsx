import PasswordLoginForm from './PasswordLoginForm';

const HomeLoginPanel = () => {
  return (
    <div className="relative z-10 w-full max-w-[440px] lg:mx-0">
      <div className="rounded-3xl border border-white/[0.09] bg-[#0a1628]/80 p-8 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.65)] backdrop-blur-2xl ring-1 ring-white/[0.05]">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white">登录工作台</h2>
          <p className="mt-1.5 text-sm text-slate-400">使用企业账号与密码进入智创制课</p>
        </div>

        <PasswordLoginForm />

        <div className="mt-8 flex items-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
          <span className="text-[11px] font-medium text-slate-600">其他方式</span>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
        </div>

        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] text-slate-300 transition hover:border-emerald-500/35 hover:bg-emerald-500/10 hover:text-emerald-300"
            aria-label="微信登录"
          >
            <i className="ri-wechat-fill text-[22px] text-emerald-400" />
          </button>
        </div>

        <p className="mt-7 text-center text-[11px] leading-relaxed text-slate-600">
          登录即表示同意
          <a href="#" className="text-emerald-500/90 hover:text-emerald-400 hover:underline">
            用户协议
          </a>
          与
          <a href="#" className="text-emerald-500/90 hover:text-emerald-400 hover:underline">
            隐私政策
          </a>
        </p>
      </div>
    </div>
  );
};

export default HomeLoginPanel;
