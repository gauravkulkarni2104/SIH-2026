# SIH-2026

PROJECT IMPLEMENTATION WORKFLOW

1) IDEA:

i)THE project will be converting ulpin 14 digit 2d to a unique new ulpin
containing the previous 14 digit code + floor data+ undergaround data [ 3D design of the system]

ii)FOR IMPLEMENTATION we stritly NEED to USE
    1)DRONE IMAGE(CAN BE USED TO PREDICT HEIGHT OF BUILDING OR EXITANCE OF BUILDING)
    2)LIDAR/3d point cloud( MAINY USE TO PREDICT HEIGHT OF BUILDING)
    3)DEM AND DSM for buiding and terrain height
    4)GNS AND CORS  for lat and long
    5)FLoor plans for confirmation
    

2) OUTPUT:
    i)The system should provide a 3D ulpin.
    ii)3D imagery of the exact property according to 3D ulpin no.
        [FLOORS AND UNDERGROUND AND AREA SHOULD BE SAME AS OLD 2D ulpin NO]



3) PLAN:
    i)a)Give a unique coordinates 2d to a specific area then use those to covert into 3D on map..
      b)create a new ulpin for a specific area.  
    ii) Use drone imagery for finding building and underground[By looking structure we can check if undergrounde parking exist or not like if its a mall or hospital parking may exist ( or just check data for that building )] .(GNSS)
    iii)Find height using dem and dsm
        DEM= the land empty
        DSM=LAnd with building
        HEIGHT=DSM-DEM
        [Exact height of building can be calulated but not undergorund parking or anything ]
        
    iv) try to find muncipal actual data of the location like is it residential or school or mall etc for exact prediction or what height limit of building is there.

    v) now consider all of this things and divide it into threes ections

    Green: all the points are satisfied and the builiding is confirmed.              
    Yellow: cannot confirm  but elevation is available so floor can be predicted.    
    Red:prediction only based on drone imagery.   

THE ABOVE CAN BE CONVERTED TO SHOWING ONLY GREEN FOR A SPECFIC DATA FOR PROTOTYPE.
           TELL WHAT TO DO KEEP IT AS THIS OR ONLY CONFIRM ULPIN(GREEN)

    vi) now take the data and create a 3D model for that exact location ca also do complete mapping of a 10-15 building for a specific area for prototype.

4) UI OF WEBSITE

    Page1)
    we would have already added some ulpin 2D deafultly that can be changed to 3D
    or ADD new area drectly to 3D

    page2)
    Now it will show the specific area piining location (A MAP)

    page3)
    click on it  and it will take to 3D diagram showing information

    CAN ADD SOME MORE EXTRA FEATURES NOT SO REALTED TO BACKEND


