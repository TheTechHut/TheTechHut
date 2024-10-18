{/* <sup className="rounded-full text-xs cursor-pointer [&>*]:!text-white h-4 w-4 px-1 bg-zinc-400 hover:bg-zinc-500 dark:bg-zinc-700 hover:dark:bg-zinc-600">[6](https://dev.to/sameer8saini/countdown-timer-using-html-css-and-javascript-22d3)</sup> */ }

const countdownDate = new Date("Oct 24, 2024 24:00:00").getTime();

const daysElement = document.getElementById("days");
const hoursElement = document.getElementById("hours");
const minutesElement = document.getElementById("minutes");
const secondsElement = document.getElementById("seconds");

const countdownTimer = setInterval(function () {
    const now = new Date().getTime();
    const distance = countdownDate - now;

    const days = String(Math.floor(distance / (1000 * 60 * 60 * 24))).padStart(2, '0');
    const hours = String(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
    const minutes = String(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
    const seconds = String(Math.floor((distance % (1000 * 60)) / 1000)).padStart(2, '0');

    daysElement.textContent = days;
    hoursElement.textContent = hours;
    minutesElement.textContent = minutes;
    secondsElement.textContent = seconds;

    if (distance < 0) {
        clearInterval(countdownTimer);
        daysElement.textContent = "00";
        hoursElement.textContent = "00";
        minutesElement.textContent = "00";
        secondsElement.textContent = "00";
    }
}, 1000);
