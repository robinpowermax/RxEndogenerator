export type SystemMode = 'nitrogen-methanol' | 'pure-methanol';
export type MethanolInputMode = 'ton-year' | 'liter-hour';
export type HeatingType = 'gas' | 'electric';

export interface EquipmentItem {
  model: string;
  quantity: number;
  unitPrice: number;
}

export interface LogicConfig {
  version: string;
  methanolCrackCoeff: number; // 1L甲醇产生的蒸汽体积 (默认1.67)
  nmConversionCoeff: number; // 氮甲醇换算总系数 (默认2.77)
  ventilationCoeff: number;  // 纯甲醇换气系数 (默认1)
  rxEfficiency: number;      // Rx炉产气效率 (1:5.3)
  n2Ratio: number;          // 氮气配比 (1.1)
  methanolDensity: number;   // 甲醇密度 (0.8)
  elecPerLMethanol: number; // 甲醇裂解功耗 (0.7)
  ln2ToGasCoeff: number;    // 液氮变为氮气系数 (默认647)
}

export interface InputParameters {
  projectName: string;
  customerName: string;
  runningDays: number;
  runningHours: number;
  naturalGasPrice: number;
  methanolPricePerTon: number;
  nitrogenPricePerTon: number;
  electricityPrice: number;
  mode: SystemMode;
  methanolInputMode: MethanolInputMode;
  methanolHourlyLiters: number;
  currentMethanolAnnualTons: number;
  currentNitrogenAnnualLiquidM3: number;
  rxHeatingType: HeatingType;
  rxHeatingGasHourly: number;
  rxHeatingElectricityHourly: number;
  rxElectricityHourly: number;
  investmentItems: EquipmentItem[];
  depreciationLife: number;
  includeDepreciation: boolean;
}

export interface CalculationResult {
  totalHours: number;
  totalCrackedGasVolume: number; 
  crackedGasVolumeFromMethanol: number;
  hourlyGasVolume: number;      
  methanolAnnualCost: number;
  nitrogenAnnualCost: number;
  crackingElectricityAnnualCost: number;
  totalCurrentAnnualCost: number;
  currentCostPerHour: number;
  rxReactionGasAnnual: number;   
  rxHeatingGasAnnual: number;    
  rxHeatingElectricityAnnual: number; 
  rxElectricityAnnual: number;
  rxElectricityAnnualCost: number;
  rxNaturalGasAnnualCost: number;
  totalRxOperatingCost: number;
  totalInvestment: number;
  annualDepreciation: number;
  totalRxAnnualCost: number; 
  rxCostPerHour: number;
  annualSavings: number;
  savingsRate: number;
  paybackPeriod: number; 
}