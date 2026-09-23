from turtle import * 

# screen or turtle sath kare

bgcolor ('white')
flower = Turtle()
flower.speed(10)
flower.pencolor('purple')

# ek petal make ka function

def drew_petal():
    flower.circle(100,60)
    flower.left(120)
    flower.circle(100.60)
    flower.left(120)
    
    
for _ in range(6):
    drew_petal()
    flower.left(60)

# ful ka central 

flower.penup()
flower.goto(0 , -40)
flower.pendown()
flower.begin_fill()
flower.color("yellow")
flower.circle(100)
flower.end_fill()

# turtle

flower.hideturtle()
done()             