import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  Calculator, 
  Download, 
  TrendingDown, 
  Settings2,
  Zap,
  Briefcase,
  ChevronRight,
  ArrowLeft,
  User,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Code,
  Save,
  RotateCcw,
  Package,
  Layers,
  FileText
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Cell, 
  ResponsiveContainer 
} from 'recharts';
import { InputParameters, CalculationResult, EquipmentItem, LogicConfig } from './types';
import { DEFAULT_INPUTS, COLORS, TRANSLATIONS, DEFAULT_LOGIC, EQUIPMENT_MODELS } from './constants';

const App: React.FC = () => {
  // --- 状态管理 ---
  const [inputs, setInputs] = useState<InputParameters>(DEFAULT_INPUTS);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [view, setView] = useState<'setup' | 'calculator'>('setup');
  const [isInvestmentExpanded, setIsInvestmentExpanded] = useState(true);
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  
  // 用于追踪上一次输入的关键参数，判断是否需要自动更新关联数值
  const prevMethanolRef = useRef<number>(DEFAULT_INPUTS.methanolInputMode === 'ton-year' ? DEFAULT_INPUTS.currentMethanolAnnualTons : DEFAULT_INPUTS.methanolHourlyLiters);
  const prevInputModeRef = useRef<string>(DEFAULT_INPUTS.methanolInputMode);

  // 计算逻辑配置
  const [logicConfig, setLogicConfig] = useState<LogicConfig>(() => {
    const saved = localStorage.getItem('powermax_logic_v16');
    return saved ? JSON.parse(saved) : DEFAULT_LOGIC;
  });
  const [showLogicEditor, setShowLogicEditor] = useState(false);

  const t = (TRANSLATIONS as any)[lang] || TRANSLATIONS.zh;

  const toggleRowExpansion = (rowId: string) => {
    setExpandedRows(prev => prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]);
  };

  // --- 核心计算引擎 ---
  const results = useMemo((): CalculationResult => {
    const { 
      methanolCrackCoeff, 
      ventilationCoeff, 
      rxEfficiency, 
      methanolDensity, 
      elecPerLMethanol,
      ln2ToGasCoeff
    } = logicConfig;

    const totalHours = inputs.runningDays * inputs.runningHours;
    
    // 1. 甲醇耗量计算
    let annualMethanolTons = 0;
    let annualMethanolLiters = 0;
    let hourlyMethanolLiters = 0;

    if (inputs.methanolInputMode === 'ton-year') {
      annualMethanolTons = inputs.currentMethanolAnnualTons;
      annualMethanolLiters = (annualMethanolTons * 1000) / (methanolDensity || 0.8);
      hourlyMethanolLiters = totalHours > 0 ? annualMethanolLiters / totalHours : 0;
    } else {
      hourlyMethanolLiters = inputs.methanolHourlyLiters;
      annualMethanolLiters = hourlyMethanolLiters * totalHours;
      annualMethanolTons = (annualMethanolLiters * (methanolDensity || 0.8)) / 1000;
    }

    // 2. 产气量与氮气总耗计算
    let hourlyGasVolume = 0;
    let nitrogenAnnualVolume = 0;
    
    if (inputs.mode === 'nitrogen-methanol') {
      const methanolVaporHourly = hourlyMethanolLiters * methanolCrackCoeff;
      const nitrogenHourlyDerived = methanolVaporHourly * 4 / 6;
      hourlyGasVolume = methanolVaporHourly + nitrogenHourlyDerived;
      
      if (inputs.methanolInputMode === 'ton-year') {
        nitrogenAnnualVolume = inputs.currentNitrogenAnnualLiquidM3;
      } else {
        nitrogenAnnualVolume = inputs.currentNitrogenAnnualLiquidM3 * totalHours;
      }
    } else {
      hourlyGasVolume = hourlyMethanolLiters * methanolCrackCoeff * ventilationCoeff;
      nitrogenAnnualVolume = 0;
    }

    const totalCrackedGasVolume = hourlyGasVolume * totalHours;

    // 3. 现状系统成本
    const methanolAnnualCost = Math.round(annualMethanolTons * inputs.methanolPricePerTon);
    
    // 液氮成本换算 logic: 吨/年模式下使用系数转为气态体积
    const nitrogenAnnualCost = Math.round(
      inputs.methanolInputMode === 'ton-year'
        ? (nitrogenAnnualVolume * (ln2ToGasCoeff || 647) * inputs.nitrogenPricePerTon)
        : (nitrogenAnnualVolume * inputs.nitrogenPricePerTon)
    );
    
    const crackingElectricityAnnualCost = Math.round(annualMethanolLiters * elecPerLMethanol * inputs.electricityPrice);
    
    const totalCurrentAnnualCost = methanolAnnualCost + nitrogenAnnualCost + crackingElectricityAnnualCost;
    const currentCostPerHour = totalHours > 0 ? totalCurrentAnnualCost / totalHours : 0;

    // 4. Rx 方案成本
    const rxReactionGasAnnual = totalCrackedGasVolume / rxEfficiency;
    let rxHeatingGasAnnual = 0;
    let rxHeatingElectricityAnnualCost = 0;
    
    if (inputs.rxHeatingType === 'gas') {
      rxHeatingGasAnnual = (inputs.rxHeatingGasHourly || 0) * totalHours;
    } else {
      rxHeatingElectricityAnnualCost = Math.round(inputs.rxHeatingElectricityHourly * totalHours * inputs.electricityPrice);
    }

    // 天然气年度总成本 = (工艺耗气 + 加热耗气) * 单价
    const rxNaturalGasAnnualCost = Math.round((rxReactionGasAnnual + rxHeatingGasAnnual) * inputs.naturalGasPrice);
    // 运行电力年度总成本 = 运行功耗 * 时间 * 电价
    const rxRunningElectricityAnnualCost = Math.round((inputs.rxElectricityHourly || 0) * totalHours * inputs.electricityPrice);
    
    // Rx 方案下辅助动力总成本 = 运行电力成本 + (若电加热则包含加热用电成本)
    const totalRxOperatingCost = rxNaturalGasAnnualCost + rxRunningElectricityAnnualCost + rxHeatingElectricityAnnualCost;

    // 5. 投资与折旧
    const totalInvestment = Math.round(inputs.investmentItems.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0));
    const annualDepreciation = inputs.includeDepreciation && inputs.depreciationLife > 0 
      ? Math.round(totalInvestment / inputs.depreciationLife)
      : 0;
    
    const totalRxAnnualCost = totalRxOperatingCost + annualDepreciation;
    const rxCostPerHour = totalHours > 0 ? totalRxAnnualCost / totalHours : 0;

    const annualSavings = totalCurrentAnnualCost - totalRxAnnualCost;
    const savingsRate = totalCurrentAnnualCost > 0 ? (annualSavings / totalCurrentAnnualCost) * 100 : 0;
    const paybackPeriod = annualSavings > 0 ? (totalInvestment / annualSavings) * 12 : 0;

    return {
      totalHours, totalCrackedGasVolume, crackedGasVolumeFromMethanol: annualMethanolLiters * methanolCrackCoeff, 
      hourlyGasVolume, methanolAnnualCost, nitrogenAnnualCost,
      crackingElectricityAnnualCost, totalCurrentAnnualCost, currentCostPerHour, rxReactionGasAnnual,
      rxHeatingGasAnnual, rxHeatingElectricityAnnual: inputs.rxHeatingElectricityHourly * totalHours, 
      rxElectricityAnnual: (inputs.rxElectricityHourly || 0) * totalHours, 
      rxElectricityAnnualCost: rxRunningElectricityAnnualCost + rxHeatingElectricityAnnualCost, 
      rxNaturalGasAnnualCost,
      totalRxOperatingCost, totalInvestment, annualDepreciation, totalRxAnnualCost, rxCostPerHour,
      annualSavings, savingsRate, paybackPeriod
    };
  }, [inputs, logicConfig]);

  // --- 联动逻辑 ---
  useEffect(() => {
    const { methanolCrackCoeff, methanolDensity, ventilationCoeff } = logicConfig;
    const currentMethanolValue = inputs.methanolInputMode === 'ton-year' ? inputs.currentMethanolAnnualTons : inputs.methanolHourlyLiters;
    
    if (currentMethanolValue === prevMethanolRef.current && inputs.methanolInputMode === prevInputModeRef.current) {
        return;
    }
    
    let hourlyLiters = 0;
    let n2RecommendedVal = inputs.currentNitrogenAnnualLiquidM3;

    if (inputs.methanolInputMode === 'liter-hour') {
      hourlyLiters = inputs.methanolHourlyLiters;
      n2RecommendedVal = Number((hourlyLiters * 1.1).toFixed(2));
    } else {
      const totalHours = inputs.runningDays * inputs.runningHours;
      if (totalHours > 0) {
        hourlyLiters = (inputs.currentMethanolAnnualTons * 1000) / methanolDensity / totalHours;
      }
      n2RecommendedVal = Number((inputs.currentMethanolAnnualTons * 2.15).toFixed(2));
    }

    const methanolVaporHourly = hourlyLiters * methanolCrackCoeff;
    const n2HourlyDerived = Number((methanolVaporHourly * 4 / 6).toFixed(2));
    const gasVolume = inputs.mode === 'nitrogen-methanol' ? (methanolVaporHourly + n2HourlyDerived) : (methanolVaporHourly * ventilationCoeff);
    
    // 加热能耗联动逻辑：
    // 电加热：切换Rx气需求量 * 0.36
    // 燃气加热：切换Rx气需求量 * 0.036
    const recommendedHeatingElec = Number(Math.max(12, gasVolume * 0.36).toFixed(1));
    const recommendedHeatingGas = Number((gasVolume * 0.036).toFixed(2));

    setInputs(prev => ({
      ...prev,
      currentNitrogenAnnualLiquidM3: inputs.mode === 'nitrogen-methanol' ? n2RecommendedVal : prev.currentNitrogenAnnualLiquidM3,
      rxHeatingElectricityHourly: (prev.rxHeatingType === 'electric') ? recommendedHeatingElec : prev.rxHeatingElectricityHourly,
      rxHeatingGasHourly: (prev.rxHeatingType === 'gas') ? recommendedHeatingGas : prev.rxHeatingGasHourly
    }));

    prevMethanolRef.current = currentMethanolValue;
    prevInputModeRef.current = inputs.methanolInputMode;
  }, [inputs.methanolHourlyLiters, inputs.currentMethanolAnnualTons, inputs.methanolInputMode, inputs.mode, inputs.rxHeatingType, logicConfig, inputs.runningDays, inputs.runningHours]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let val: any = value;
    if (type === 'number') val = parseFloat(value) || 0;
    if (type === 'checkbox') val = (e.target as HTMLInputElement).checked;
    setInputs(prev => ({ ...prev, [name]: val }));
  };

  const handleLogicSave = () => {
    const versionParts = logicConfig.version.split('.');
    const lastPart = parseInt(versionParts[versionParts.length - 1]);
    versionParts[versionParts.length - 1] = (lastPart + 1).toString();
    const newVersion = versionParts.join('.');
    const newConfig = { ...logicConfig, version: newVersion };
    setLogicConfig(newConfig);
    localStorage.setItem('powermax_logic_v16', JSON.stringify(newConfig));
    setShowLogicEditor(false);
  };

  const addInvestmentItem = () => setInputs(p => ({ ...p, investmentItems: [...p.investmentItems, { model: EQUIPMENT_MODELS[2], quantity: 1, unitPrice: 0 }]}));
  const removeInvestmentItem = (idx: number) => setInputs(p => ({ ...p, investmentItems: p.investmentItems.filter((_, i) => i !== idx)}));
  const updateInvestmentItem = (idx: number, f: keyof EquipmentItem, v: any) => setInputs(p => {
    const items = [...p.investmentItems];
    items[idx] = { ...items[idx], [f]: v };
    return { ...p, investmentItems: items };
  });

  if (view === 'setup') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 animate-in fade-in duration-500">
        <div className="max-w-5xl w-full bg-white rounded-[3rem] shadow-2xl overflow-hidden border border-slate-100 flex flex-col md:flex-row min-h-[600px]">
          <div className="bg-slate-900 md:w-2/5 p-12 text-white flex flex-col justify-between">
            <div>
              <div className="bg-blue-600 p-5 rounded-3xl shadow-xl w-fit mb-8"><Calculator className="w-12 h-12" /></div>
              <h1 className="text-3xl font-black mb-4 leading-tight tracking-tight">{t.company}</h1>
              <div className="h-1 w-16 bg-blue-500 rounded-full mb-6"></div>
              <h2 className="text-xl font-bold text-slate-200 mb-6">{t.setupTitle}</h2>
              <p className="text-slate-400 text-sm font-medium leading-relaxed opacity-80">{t.supportText}</p>
            </div>
            <div className="space-y-6">
              <div className="flex bg-slate-800 rounded-3xl p-1.5 border border-slate-700">
                <button onClick={() => setLang('zh')} className={`flex-1 py-3 rounded-2xl text-sm font-black transition-all ${lang === 'zh' ? 'bg-blue-600 shadow-lg text-white' : 'text-slate-500 hover:text-slate-300'}`}>简体中文</button>
                <button onClick={() => setLang('en')} className={`flex-1 py-3 rounded-2xl text-sm font-black transition-all ${lang === 'en' ? 'bg-blue-600 shadow-lg text-white' : 'text-slate-500 hover:text-slate-300'}`}>English</button>
              </div>
              <div className="flex items-center justify-between opacity-50">
                <p className="text-[10px] font-black uppercase tracking-widest">PowerMax Atmosphere Analyst</p>
                <span className="text-[10px] bg-slate-800 px-2 py-1 rounded font-black text-blue-400">{logicConfig.version}</span>
              </div>
            </div>
          </div>
          <div className="md:w-3/5 p-12 space-y-10 bg-white overflow-y-auto max-h-[95vh]">
            <section className="space-y-6">
              <div className="flex items-center gap-4"><div className="p-3 bg-blue-50 rounded-2xl"><User className="w-6 h-6 text-blue-600" /></div><h2 className="text-2xl font-black text-slate-800">{t.custName}</h2></div>
              <input type="text" name="customerName" placeholder={t.custPlaceholder} value={inputs.customerName} onChange={(e) => setInputs(p => ({ ...p, customerName: e.target.value }))} className="w-full px-8 py-6 bg-slate-50 border-2 border-transparent rounded-[2rem] text-2xl font-black focus:ring-8 focus:ring-blue-50 focus:border-blue-500 focus:bg-white outline-none transition-all placeholder:text-slate-200" />
            </section>
            
            <section className="space-y-6">
              <div className="flex items-center gap-4"><div className="p-3 bg-blue-50 rounded-2xl"><FileText className="w-6 h-6 text-blue-600" /></div><h2 className="text-2xl font-black text-slate-800">{t.projName}</h2></div>
              <input type="text" name="projectName" value={inputs.projectName} onChange={(e) => setInputs(p => ({ ...p, projectName: e.target.value }))} className="w-full px-8 py-4 bg-slate-50 border-2 border-transparent rounded-[1.5rem] text-lg font-bold focus:ring-8 focus:ring-blue-50 focus:border-blue-500 focus:bg-white outline-none transition-all" />
            </section>

            <section className="space-y-8">
              <div className="flex items-center gap-4"><div className="p-3 bg-blue-50 rounded-2xl"><Settings2 className="w-6 h-6 text-blue-600" /></div><h2 className="text-2xl font-black text-slate-800">{t.basicData}</h2></div>
              <div className="grid grid-cols-2 gap-6">
                <CompactInputField label={t.daysPerYear} name="runningDays" value={inputs.runningDays} onChange={handleInputChange} />
                <CompactInputField label={t.hoursPerDay} name="runningHours" value={inputs.runningHours} onChange={handleInputChange} />
                <CompactInputField label={t.ngPrice} name="naturalGasPrice" value={inputs.naturalGasPrice} onChange={handleInputChange} />
                <CompactInputField label={t.elecPrice} name="electricityPrice" value={inputs.electricityPrice} onChange={handleInputChange} />
                <CompactInputField label={t.methPrice} name="methanolPricePerTon" value={inputs.methanolPricePerTon} onChange={handleInputChange} />
                <CompactInputField label={t.n2Price} name="nitrogenPricePerTon" value={inputs.nitrogenPricePerTon} onChange={handleInputChange} />
              </div>
            </section>
            <div className="pt-8"><button onClick={() => setView('calculator')} className="group flex items-center justify-center gap-4 w-full bg-slate-900 hover:bg-blue-600 text-white py-6 rounded-[2.5rem] text-lg font-black transition-all shadow-2xl active:scale-[0.98]">{t.startBtn} <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" /></button></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col overflow-x-hidden animate-in fade-in duration-700">
      <header className="bg-slate-900 text-white py-4 px-8 shadow-xl no-print sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button onClick={() => setView('setup')} className="p-3 bg-slate-800 hover:bg-blue-600 rounded-2xl transition-all text-blue-400 shadow-inner group"><ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" /></button>
            <div className="leading-tight">
              <h1 className="text-lg font-black tracking-tight">{t.company}</h1>
              <div className="flex items-center gap-3"><span className="text-[10px] bg-blue-600 px-2 py-0.5 rounded font-black uppercase tracking-widest">{lang}</span><p className="text-[11px] text-slate-400 font-bold uppercase tracking-wide">{inputs.customerName || 'N/A'}</p></div>
            </div>
          </div>
          <button onClick={() => window.print()} className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-2xl transition-all text-sm font-black shadow-lg"><Download className="w-4 h-4" /> {t.exportBtn}</button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-8 space-y-8 no-print pb-24">
        <div className="bg-white border-l-8 border-blue-600 px-10 py-8 rounded-[3rem] shadow-sm flex items-center justify-between">
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-slate-900">{inputs.customerName || '未命名客户'}</h2>
            <div className="flex items-center gap-3 text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">
              <Briefcase className="w-4 h-4 text-blue-500" />
              {inputs.projectName || '未命名项目'}
            </div>
          </div>
          <div className="flex items-center gap-10">
            <MetricBox label={t.annualCostCurrent} value={results.totalCurrentAnnualCost} color="orange" />
            <div className="w-px h-12 bg-slate-200"></div>
            <MetricBox label={t.annualCostRx} value={results.totalRxAnnualCost} color="emerald" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-4 flex flex-col gap-6">
            <SectionCard title={`${t.currentSystem} (${inputs.mode === 'nitrogen-methanol' ? t.modeNM : t.modePM})`} icon={<RotateCcw className="w-4 h-4 text-orange-500" />} color="orange">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">{t.modeSelect}</label><select name="mode" value={inputs.mode} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-[12px] font-black focus:border-orange-500 outline-none">
                    <option value="nitrogen-methanol">{t.modeNM}</option><option value="pure-methanol">{t.modePM}</option></select></div>
                  <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">{t.inputMode}</label><select name="methanolInputMode" value={inputs.methanolInputMode} onChange={handleInputChange} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-[12px] font-black focus:border-slate-800 outline-none">
                    <option value="ton-year">{t.inputModeT}</option><option value="liter-hour">{t.inputModeL}</option></select></div>
                </div>
                <div className="space-y-4 pt-3 border-t border-slate-50">
                  {inputs.methanolInputMode === 'ton-year' ? <CompactInputField label={t.methUsage} name="currentMethanolAnnualTons" value={inputs.currentMethanolAnnualTons} onChange={handleInputChange} /> : <CompactInputField label={t.methHourly} name="methanolHourlyLiters" value={inputs.methanolHourlyLiters} onChange={handleInputChange} />}
                  {inputs.mode === 'nitrogen-methanol' && (
                    <CompactInputField 
                      label={<span><span className="text-blue-600">{inputs.methanolInputMode === 'ton-year' ? t.n2UsageText : t.n2HourlyText}</span>{inputs.methanolInputMode === 'ton-year' ? t.n2UsageUnit : t.n2HourlyUnit}</span>} 
                      name="currentNitrogenAnnualLiquidM3" 
                      value={inputs.currentNitrogenAnnualLiquidM3} 
                      onChange={handleInputChange} 
                      title={`${t.n2WeightTooltip} ${((inputs.methanolInputMode === 'ton-year' ? inputs.currentNitrogenAnnualLiquidM3 : inputs.currentNitrogenAnnualLiquidM3 * results.totalHours) * 1.2376).toFixed(2)} ${t.weightUnit}/年`}
                    />
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t.rxSystem} icon={<Zap className="w-4 h-4 text-emerald-500" />} color="emerald">
              <div className="space-y-4">
                <div className="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100 text-right shadow-inner">
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">{t.hourlyGas}</p>
                  <p className="text-3xl font-black text-emerald-900 leading-none">{results.hourlyGasVolume.toFixed(1)} <span className="text-xs font-normal opacity-50">m³/h</span></p>
                  <div className="mt-4 pt-3 border-t border-emerald-200/50">
                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-wider mb-0.5">{t.processNG}</p>
                    <p className="text-sm font-black text-emerald-800">{(results.hourlyGasVolume / logicConfig.rxEfficiency).toFixed(2)} <span className="text-[10px] opacity-60">m³/h</span></p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">{t.heatingType}</label><div className="flex bg-slate-50 p-1 rounded-xl border border-slate-100">
                    <button onClick={() => setInputs({...inputs, rxHeatingType: 'gas'})} className={`flex-1 py-2 rounded-lg text-[11px] font-black transition-all ${inputs.rxHeatingType === 'gas' ? 'bg-white shadow text-emerald-600' : 'text-slate-400'}`}>{t.gasHeating}</button>
                    <button onClick={() => setInputs({...inputs, rxHeatingType: 'electric'})} className={`flex-1 py-2 rounded-lg text-[11px] font-black transition-all ${inputs.rxHeatingType === 'electric' ? 'bg-white shadow text-emerald-600' : 'text-slate-400'}`}>{t.elecHeating}</button>
                  </div></div>
                  {inputs.rxHeatingType === 'gas' ? <CompactInputField label={t.heatingGas} name="rxHeatingGasHourly" value={inputs.rxHeatingGasHourly} onChange={handleInputChange} /> : <CompactInputField label={t.heatingElec} name="rxHeatingElectricityHourly" value={inputs.rxHeatingElectricityHourly} onChange={handleInputChange} />}
                  <CompactInputField label={t.rxElec} name="rxElectricityHourly" value={inputs.rxElectricityHourly} onChange={handleInputChange} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title={t.investmentSection} icon={<Package className="w-4 h-4 text-blue-500" />} color="blue" headerRight={<button onClick={() => setIsInvestmentExpanded(!isInvestmentExpanded)} className="text-slate-400 hover:text-blue-500 p-1">{isInvestmentExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}</button>}>
              {isInvestmentExpanded && (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                  <div className="flex items-center justify-between px-2 py-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2"><Layers className="w-4 h-4 text-blue-500" /><span className="text-[11px] font-black text-slate-700">{t.calcDepr}</span></div>
                    <input type="checkbox" name="includeDepreciation" checked={inputs.includeDepreciation} onChange={handleInputChange} className="w-5 h-5 accent-blue-600 cursor-pointer" />
                  </div>
                  {inputs.includeDepreciation && <CompactInputField label={t.depreciation} name="depreciationLife" value={inputs.depreciationLife} onChange={handleInputChange} />}
                  {inputs.investmentItems.map((item, index) => (
                    <div key={index} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3 relative group">
                      <div className="flex justify-between items-center"><select value={item.model} onChange={(e) => updateInvestmentItem(index, 'model', e.target.value)} className="bg-transparent font-black text-xs text-slate-800 outline-none">{EQUIPMENT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select><button onClick={() => removeInvestmentItem(index)} className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><Trash2 size={14} /></button></div>
                      <div className="grid grid-cols-2 gap-3"><CompactInputField label={t.quantity} value={item.quantity} onChange={(e: any) => updateInvestmentItem(index, 'quantity', parseInt(e.target.value) || 0)} /><CompactInputField label={t.unitPrice} value={item.unitPrice} onChange={(e: any) => updateInvestmentItem(index, 'unitPrice', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                  ))}
                  <button onClick={addInvestmentItem} className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:border-blue-500 hover:text-blue-500 transition-all"><Plus size={14} /> {t.addItem}</button>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <div className="bg-slate-900 p-12 rounded-[3.5rem] text-white flex justify-between items-center shadow-2xl relative overflow-hidden group">
              <TrendingDown className="absolute -right-16 -bottom-16 w-80 h-80 opacity-5 group-hover:scale-110 transition-transform duration-1000" />
              <div className="z-10"><p className="text-[11px] font-black uppercase opacity-50 tracking-[0.2em] mb-3">{t.savings}</p><div className="flex items-baseline gap-4"><h3 className="text-6xl font-black tracking-tighter text-blue-400">¥{results.annualSavings.toLocaleString()}</h3><span className="text-2xl font-black text-emerald-400 opacity-80">{results.savingsRate.toFixed(1)}%</span></div></div>
              <div className="text-right z-10 border-l border-white/10 pl-12"><p className="text-[11px] font-black uppercase opacity-50 tracking-[0.2em] mb-3">{t.payback}</p><p className="text-5xl font-black">{results.paybackPeriod.toFixed(1)} <span className="text-sm uppercase font-bold text-blue-400">{t.months}</span></p></div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
               <table className="w-full text-left text-sm">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 border-b"><th className="px-10 py-5">{t.item}</th><th className="px-10 py-5 text-right">{t.current}</th><th className="px-10 py-5 text-right">{t.rx}</th><th className="px-10 py-5 text-right">{t.diff}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 font-bold">
                    <ExpandableDataRow 
                      label={t.fuelCost} 
                      v1={results.methanolAnnualCost + results.nitrogenAnnualCost} 
                      v2={results.rxNaturalGasAnnualCost} 
                      currency="¥" 
                      isExpanded={expandedRows.includes('medium')}
                      onToggle={() => toggleRowExpansion('medium')}
                      details={[
                        { label: t.breakdownMethanol, v1: results.methanolAnnualCost, v2: 0 },
                        { label: t.breakdownNitrogen, v1: results.nitrogenAnnualCost, v2: 0 },
                        { label: t.breakdownGas, v1: 0, v2: results.rxNaturalGasAnnualCost },
                      ]}
                    />
                    <ExpandableDataRow 
                      label={t.auxCost} 
                      v1={results.crackingElectricityAnnualCost} 
                      v2={results.rxElectricityAnnualCost} 
                      currency="¥" 
                      isExpanded={expandedRows.includes('power')}
                      onToggle={() => toggleRowExpansion('power')}
                      details={[
                        { label: t.breakdownElec, v1: results.crackingElectricityAnnualCost, v2: results.rxElectricityAnnualCost },
                      ]}
                    />
                    {inputs.includeDepreciation && <DataRow label={t.deprCost} v1={0} v2={results.annualDepreciation} currency="¥" />}
                    <tr className="bg-slate-900 text-white font-black"><td className="px-10 py-8 uppercase text-xs tracking-widest">{t.annualCost}</td><td className="px-10 py-8 text-right text-lg">¥{results.totalCurrentAnnualCost.toLocaleString()}</td><td className="px-10 py-8 text-right text-lg">¥{results.totalRxAnnualCost.toLocaleString()}</td><td className="px-10 py-8 text-right text-xl text-blue-400">-{results.savingsRate.toFixed(1)}%</td></tr>
                  </tbody>
               </table>
            </div>

            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">{t.chartCostScale}</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ name: t.current, cost: results.totalCurrentAnnualCost }, { name: t.rx, cost: results.totalRxAnnualCost }]}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fontWeight: 800}} />
                    <YAxis hide />
                    <Tooltip cursor={{fill: '#f8fafc'}} />
                    <Bar dataKey="cost" radius={[12, 12, 0, 0]} barSize={80}>
                      <Cell fill={COLORS.current} /><Cell fill={COLORS.rx} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-100 p-8 rounded-[3rem] border border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-6">
               <div className="space-y-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.daysPerYear}</p><p className="text-lg font-black text-slate-800">{inputs.runningDays} {lang === 'zh' ? '天' : 'Days'}</p></div>
               <div className="space-y-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.hoursPerDay}</p><p className="text-lg font-black text-slate-800">{inputs.runningHours} {lang === 'zh' ? '小时' : 'Hrs'}</p></div>
               <div className="space-y-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.summaryPriceTitle}</p><p className="text-xs font-black text-slate-800 leading-relaxed">{inputs.methanolPricePerTon} / {inputs.nitrogenPricePerTon} / {inputs.naturalGasPrice} / {inputs.electricityPrice}</p></div>
               <div className="space-y-1"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.totalInvSummary}</p><p className="text-lg font-black text-blue-600">¥{results.totalInvestment.toLocaleString()}</p></div>
            </div>

            <div className="pt-10 flex justify-center no-print">
               <button onClick={() => setShowLogicEditor(true)} className="flex items-center gap-2 text-[10px] font-black text-slate-400 opacity-30 hover:opacity-100 hover:text-blue-500 uppercase tracking-widest transition-all py-3 px-6 border border-dashed border-slate-300 rounded-full">
                 <Code size={14} /> {t.sourceBtn}
               </button>
            </div>
          </div>
        </div>
      </main>

      {showLogicEditor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-10 py-8 bg-slate-50 border-b flex items-center justify-between">
              <div className="flex items-center gap-4"><div className="p-3 bg-blue-600 rounded-2xl shadow-lg"><Code className="w-6 h-6 text-white" /></div><div><h3 className="text-xl font-black text-slate-800">{t.logicTitle}</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.logicSub}</p></div></div>
              <button onClick={() => setShowLogicEditor(false)} className="p-3 hover:bg-slate-200 rounded-full transition-colors"><X className="w-6 h-6 text-slate-400" /></button>
            </div>
            <div className="p-10 space-y-10 overflow-y-auto">
              <div className="space-y-6"><h4 className="text-xs font-black text-blue-600 uppercase tracking-widest flex items-center gap-2"><div className="w-2 h-2 bg-blue-600 rounded-full"></div> {t.physConst}</h4>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{t.methVapor}</label><input type="number" step="0.01" value={logicConfig.methanolCrackCoeff} onChange={e => setLogicConfig({...logicConfig, methanolCrackCoeff: parseFloat(e.target.value)||0})} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-black focus:border-blue-500 outline-none" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{t.methDensity}</label><input type="number" step="0.01" value={logicConfig.methanolDensity} onChange={e => setLogicConfig({...logicConfig, methanolDensity: parseFloat(e.target.value)||0})} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-black focus:border-blue-500 outline-none" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{t.ln2Coeff}</label><input type="number" step="1" value={logicConfig.ln2ToGasCoeff} onChange={e => setLogicConfig({...logicConfig, ln2ToGasCoeff: parseFloat(e.target.value)||0})} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-black focus:border-blue-500 outline-none" /></div>
                </div>
              </div>
              <div className="space-y-6 pt-6 border-t border-slate-100"><h4 className="text-xs font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2"><div className="w-2 h-2 bg-emerald-600 rounded-full"></div> {t.modeCoeff}</h4>
                {inputs.mode === 'nitrogen-methanol' ? (<div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4"><div className="flex justify-between items-center"><label className="text-[11px] font-black text-slate-600">{t.nmCoeffTitle}</label><input type="number" step="0.01" value={logicConfig.nmConversionCoeff} onChange={e => setLogicConfig({...logicConfig, nmConversionCoeff: parseFloat(e.target.value)||0})} className="w-24 px-4 py-2 bg-white border-2 border-slate-200 rounded-xl text-sm font-black text-right" /></div><p className="text-[10px] text-slate-400 italic">{t.nmCoeffHint}</p></div>) : (<div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4"><div className="flex justify-between items-center"><label className="text-[11px] font-black text-slate-600">{t.pmCoeffTitle}</label><input type="number" step="0.01" value={logicConfig.ventilationCoeff} onChange={e => setLogicConfig({...logicConfig, ventilationCoeff: parseFloat(e.target.value)||0})} className="w-24 px-4 py-2 bg-white border-2 border-slate-200 rounded-xl text-sm font-black text-right" /></div><p className="text-[10px] text-slate-400 italic">{t.pmCoeffHint}</p></div>)}
              </div>
              <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-100"><div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{t.rxRatioTitle}</label><input type="number" step="0.1" value={logicConfig.rxEfficiency} onChange={e => setLogicConfig({...logicConfig, rxEfficiency: parseFloat(e.target.value)||0})} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-black focus:border-blue-500 outline-none" /></div><div className="space-y-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{t.crackElecTitle}</label><input type="number" step="0.1" value={logicConfig.elecPerLMethanol} onChange={e => setLogicConfig({...logicConfig, elecPerLMethanol: parseFloat(e.target.value)||0})} className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-xl text-sm font-black focus:border-blue-500 outline-none" /></div></div>
              <div className="flex gap-4 pt-8"><button onClick={handleLogicSave} className="flex-1 py-5 rounded-[1.5rem] bg-blue-600 text-white font-black text-sm flex items-center justify-center gap-2 hover:bg-blue-500 shadow-xl shadow-blue-200 transition-all active:scale-[0.98]"><Save size={18} /> {t.saveBtn} ({logicConfig.version})</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SectionCard = ({ title, icon, children, color = 'blue', headerRight }: any) => {
  const colorMap: any = { blue: 'border-blue-100', orange: 'border-orange-100', emerald: 'border-emerald-100' };
  return (
    <div className={`bg-white rounded-[2rem] shadow-sm border-2 ${colorMap[color]} transition-all flex flex-col overflow-visible`}>
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between rounded-t-[2rem] shrink-0"><div className="flex items-center gap-3"><div className="p-1.5 rounded-lg bg-white shadow-sm shrink-0">{icon}</div><h4 className="text-[10px] font-black text-slate-700 uppercase tracking-[0.1em]">{title}</h4></div>{headerRight}</div>
      <div className="p-6">{children}</div>
    </div>
  );
};

const CompactInputField = ({ label, name, value, onChange, type = 'number', step = 0.1, title }: any) => (
  <div className="space-y-1.5 flex-1 min-w-[120px]" title={title}>
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter ml-1">{label}</label>
    <input type={type} name={name} value={value} onChange={onChange} step={step} className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-100 rounded-xl text-[13px] font-black focus:ring-4 focus:ring-blue-100 focus:border-blue-600 focus:bg-white outline-none transition-all hover:border-slate-300" />
  </div>
);

const MetricBox = ({ label, value, color }: any) => {
  const colorMap: any = { orange: 'text-orange-600', emerald: 'text-emerald-600' };
  return (
    <div className="text-right"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</p><p className={`text-xl font-black ${colorMap[color]}`}>¥{Math.round(value).toLocaleString()}</p></div>
  );
};

const DataRow = ({ label, v1, v2, currency }: any) => {
  const diff = v1 - v2;
  return (
    <tr className="hover:bg-slate-50 transition-colors group">
      <td className="px-10 py-5 text-slate-600 text-xs">{label}</td>
      <td className="px-10 py-5 text-right font-bold text-slate-400 group-hover:text-slate-900 transition-colors whitespace-nowrap">{currency}{Math.round(v1).toLocaleString()}</td>
      <td className="px-10 py-5 text-right font-bold text-slate-400 group-hover:text-slate-900 transition-colors whitespace-nowrap">{currency}{Math.round(v2).toLocaleString()}</td>
      <td className={`px-10 py-5 text-right font-black whitespace-nowrap ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff >= 0 ? '-' : '+'}{currency}{Math.round(Math.abs(diff)).toLocaleString()}</td>
    </tr>
  );
};

const ExpandableDataRow = ({ label, v1, v2, currency, isExpanded, onToggle, details }: any) => {
  const diff = v1 - v2;
  return (
    <>
      <tr onClick={onToggle} className="hover:bg-slate-50 transition-colors group cursor-pointer select-none">
        <td className="px-10 py-5 text-slate-600 text-xs flex items-center gap-2">
          {isExpanded ? <ChevronUp size={14} className="text-blue-500" /> : <ChevronDown size={14} className="text-slate-300" />}
          {label}
        </td>
        <td className="px-10 py-5 text-right font-bold text-slate-400 group-hover:text-slate-900 transition-colors whitespace-nowrap">{currency}{Math.round(v1).toLocaleString()}</td>
        <td className="px-10 py-5 text-right font-bold text-slate-400 group-hover:text-slate-900 transition-colors whitespace-nowrap">{currency}{Math.round(v2).toLocaleString()}</td>
        <td className={`px-10 py-5 text-right font-black whitespace-nowrap ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff >= 0 ? '-' : '+'}{currency}{Math.round(Math.abs(diff)).toLocaleString()}</td>
      </tr>
      {isExpanded && details.map((detail: any, i: number) => {
        const dDiff = detail.v1 - detail.v2;
        return (
          <tr key={i} className="bg-slate-50/50 animate-in slide-in-from-top-2 duration-200">
            <td className="px-16 py-3 text-slate-400 text-[11px] font-bold border-l-4 border-blue-100">{detail.label}</td>
            <td className="px-10 py-3 text-right font-bold text-slate-400 text-[11px] whitespace-nowrap">{currency}{Math.round(detail.v1).toLocaleString()}</td>
            <td className="px-10 py-3 text-right font-bold text-slate-400 text-[11px] whitespace-nowrap">{currency}{Math.round(detail.v2).toLocaleString()}</td>
            <td className={`px-10 py-3 text-right font-black whitespace-nowrap text-[11px] ${dDiff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{dDiff >= 0 ? '-' : '+'}{currency}{Math.round(Math.abs(dDiff)).toLocaleString()}</td>
          </tr>
        );
      })}
    </>
  );
};

export default App;