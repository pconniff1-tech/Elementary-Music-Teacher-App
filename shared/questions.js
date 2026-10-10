// shared/questions.js
// 40 MATS tonal question definitions.
// audioFile paths match filenames uploaded to Firebase Storage under the 'audio/' folder.

const QUESTIONS = [
  { id: 1, audioFile: 'audio/t01Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 2, audioFile: 'audio/t02Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 3, audioFile: 'audio/t03Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 4, audioFile: 'audio/t04Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 5, audioFile: 'audio/t05Chair.mp3', iconLabel: 'Chair', iconEmoji: '🪑' },
  { id: 6, audioFile: 'audio/t06Hand.mp3', iconLabel: 'Hand', iconEmoji: '✋' },
  { id: 7, audioFile: 'audio/t07Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 8, audioFile: 'audio/t08Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 9, audioFile: 'audio/t09House.mp3', iconLabel: 'House', iconEmoji: '🏠' },
  { id: 10, audioFile: 'audio/t10Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 11, audioFile: 'audio/t11Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 12, audioFile: 'audio/t12Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 13, audioFile: 'audio/t13Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 14, audioFile: 'audio/t14Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 15, audioFile: 'audio/t15Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 16, audioFile: 'audio/t16Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 17, audioFile: 'audio/t17Chair.mp3', iconLabel: 'Chair', iconEmoji: '🪑' },
  { id: 18, audioFile: 'audio/t18Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 19, audioFile: 'audio/t19Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 20, audioFile: 'audio/t20Fork.mp3', iconLabel: 'Fork', iconEmoji: '🍴' },
  { id: 21, audioFile: 'audio/t21Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 22, audioFile: 'audio/t22Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 23, audioFile: 'audio/t23Hand.mp3', iconLabel: 'Hand', iconEmoji: '✋' },
  { id: 24, audioFile: 'audio/t24Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 25, audioFile: 'audio/t25Tree.mp3', iconLabel: 'Tree', iconEmoji: '🌲' },
  { id: 26, audioFile: 'audio/t26Foot.mp3', iconLabel: 'Foot', iconEmoji: '🦶' },
  { id: 27, audioFile: 'audio/t27Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 28, audioFile: 'audio/t28Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 29, audioFile: 'audio/t29Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 30, audioFile: 'audio/t30Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 31, audioFile: 'audio/t31Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 32, audioFile: 'audio/t32Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 33, audioFile: 'audio/t33Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 34, audioFile: 'audio/t34Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 35, audioFile: 'audio/t35House.mp3', iconLabel: 'House', iconEmoji: '🏠' },
  { id: 36, audioFile: 'audio/t36Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 37, audioFile: 'audio/t37Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 38, audioFile: 'audio/t38Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 39, audioFile: 'audio/t39Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 40, audioFile: 'audio/t40Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
];

// Works in browser (script tag) and Node.js (require)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QUESTIONS };
}
