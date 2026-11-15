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
