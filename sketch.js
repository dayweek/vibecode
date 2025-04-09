let scl = 20;
let snake;
let food;
let score = 0;
let baseSpeed = 10;  // Base frame rate
let speedIncrement = 0.5;  // How much to increase speed by

function setup() {
    createCanvas(600, 600);
    frameRate(baseSpeed);
    snake = new Snake();
    food = new Food();
}

function draw() {
    background(51);
    
    if (snake.eat(food.pos)) {
        food.pickLocation();
        score++;
    }
    
    snake.death();
    snake.update();
    snake.show();
    
    food.show();
    
    // Display score
    fill(255);
    textSize(20);
    textAlign(LEFT);
    text("Score: " + score, 10, height - 10);
}

function keyPressed() {
    if (keyCode === UP_ARROW && snake.yspeed !== 1) {
        snake.dir(0, -1);
    } else if (keyCode === DOWN_ARROW && snake.yspeed !== -1) {
        snake.dir(0, 1);
    } else if (keyCode === RIGHT_ARROW && snake.xspeed !== -1) {
        snake.dir(1, 0);
    } else if (keyCode === LEFT_ARROW && snake.xspeed !== 1) {
        snake.dir(-1, 0);
    }
}

class Snake {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.xspeed = 1;
        this.yspeed = 0;
        this.total = 0;
        this.tail = [];
    }

    dir(x, y) {
        this.xspeed = x;
        this.yspeed = y;
    }

    eat(pos) {
        let d = dist(this.x, this.y, pos.x, pos.y);
        if (d < 1) {
            this.total++;
            // Increase speed
            frameRate(baseSpeed + (score * speedIncrement));
            return true;
        }
        return false;
    }

    death() {
        for (let i = 0; i < this.tail.length; i++) {
            let pos = this.tail[i];
            let d = dist(this.x, this.y, pos.x, pos.y);
            if (d < 1) {
                this.total = 0;
                this.tail = [];
                score = 0;
                // Reset speed when game over
                frameRate(baseSpeed);
            }
        }
    }

    update() {
        if (this.total === this.tail.length) {
            for (let i = 0; i < this.tail.length - 1; i++) {
                this.tail[i] = this.tail[i + 1];
            }
        }
        this.tail[this.total - 1] = createVector(this.x, this.y);

        this.x = this.x + this.xspeed * scl;
        this.y = this.y + this.yspeed * scl;

        // Wrap around the screen
        if (this.x > width - scl) {
            this.x = 0;
        } else if (this.x < 0) {
            this.x = width - scl;
        }
        if (this.y > height - scl) {
            this.y = 0;
        } else if (this.y < 0) {
            this.y = height - scl;
        }
    }

    show() {
        fill(255);
        for (let i = 0; i < this.tail.length; i++) {
            rect(this.tail[i].x, this.tail[i].y, scl, scl);
        }
        rect(this.x, this.y, scl, scl);
    }
}

class Food {
    constructor() {
        this.pickLocation();
    }

    pickLocation() {
        let cols = floor(width / scl);
        let rows = floor(height / scl);
        this.pos = createVector(floor(random(cols)), floor(random(rows)));
        this.pos.mult(scl);
    }

    show() {
        fill(255, 0, 100);
        rect(this.pos.x, this.pos.y, scl, scl);
    }
} 