// Test script to clear localStorage and test login flow
console.log('Clearing localStorage...');
localStorage.clear();
console.log('localStorage cleared. Current keys:', Object.keys(localStorage));
console.log('Reloading page...');
window.location.reload();