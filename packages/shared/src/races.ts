/** The three races and six classes of PWI 1.3.6 (the only ones in scope). */
export type Race = 'human' | 'elf' | 'untamed';
export type Gender = 'male' | 'female';
export type ClassId = 'blademaster' | 'wizard' | 'archer' | 'cleric' | 'barbarian' | 'venomancer';

export interface ClassDef {
  id: ClassId;
  name: string;
  race: Race;
  genders: readonly Gender[];
}

export const RACE_NAMES: Readonly<Record<Race, string>> = {
  human: '人族',
  elf: '羽族',
  untamed: '妖族',
};

export const CLASSES: Readonly<Record<ClassId, ClassDef>> = {
  blademaster: { id: 'blademaster', name: '武侠', race: 'human', genders: ['male', 'female'] },
  wizard: { id: 'wizard', name: '法师', race: 'human', genders: ['male', 'female'] },
  archer: { id: 'archer', name: '羽芒', race: 'elf', genders: ['male', 'female'] },
  cleric: { id: 'cleric', name: '羽灵', race: 'elf', genders: ['male', 'female'] },
  barbarian: { id: 'barbarian', name: '妖兽', race: 'untamed', genders: ['male'] },
  venomancer: { id: 'venomancer', name: '妖精', race: 'untamed', genders: ['female'] },
};

export function isValidClassGender(cls: ClassId, gender: Gender): boolean {
  return CLASSES[cls].genders.includes(gender);
}

/** Return PWI 1.3.6 cultivation realm (修真境界) title for a character level. */
export function getCultivationRealm(level: number): string {
  if (level >= 70) return '大乘';
  if (level >= 60) return '渡劫';
  if (level >= 50) return '履霜';
  if (level >= 40) return '空冥';
  if (level >= 30) return '元婴';
  if (level >= 20) return '和合';
  if (level >= 10) return '灵虚';
  return '筑基';
}
